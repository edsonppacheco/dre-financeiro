import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { registrarAtividade } from '@/lib/atividades'

// POST { lancamento_id, conta_destino_id, valor_contraparte? }
// Marca um lançamento JÁ EXISTENTE (que chegou no extrato) como transferência
// para outra conta, criando o lançamento-espelho na conta de contrapartida.
// Não duplica o lançamento original. Limpa cliente/fornecedor/conta contábil.
//
// valor_contraparte: valor que entra/sai na conta de contrapartida, na MOEDA
// dela — necessário quando as duas contas são de empresas com moedas diferentes
// (o valor real recebido já reflete o câmbio/spread do banco, não é calculado
// automaticamente). Se omitido, assume o mesmo valor do lançamento original
// (comportamento padrão para transferências na mesma moeda).
export async function POST(req: NextRequest) {
  try {
    const { lancamento_id, conta_destino_id, valor_contraparte } = await req.json()
    if (!lancamento_id || !conta_destino_id) {
      return NextResponse.json({ error: 'lancamento_id e conta_destino_id obrigatórios' }, { status: 400 })
    }
    const supabase = createSupabaseAdminClient()

    const { data: l, error: lErr } = await supabase
      .from('transacoes')
      .select('id, conta_id, data, valor, tipo, descricao, transferencia_id')
      .eq('id', lancamento_id)
      .single()
    if (lErr || !l) return NextResponse.json({ error: 'lançamento não encontrado' }, { status: 404 })
    if (l.conta_id === conta_destino_id) return NextResponse.json({ error: 'a contrapartida deve ser outra conta' }, { status: 400 })

    // Moedas das duas pontas — exige valor_contraparte explícito se diferirem
    const { data: contasInfo } = await supabase
      .from('contas')
      .select('id, nome, empresas(moeda)')
      .in('id', [l.conta_id, conta_destino_id])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const infoPorId = new Map((contasInfo ?? []).map((c: any) => [c.id as string, c]))
    const moedaOrigemConta = infoPorId.get(l.conta_id)?.empresas?.moeda
    const moedaDestinoConta = infoPorId.get(conta_destino_id)?.empresas?.moeda
    const moedasDiferentes = !!moedaOrigemConta && !!moedaDestinoConta && moedaOrigemConta !== moedaDestinoConta

    const valorConhecido = Number(l.valor) // valor do lançamento original, na moeda da conta dele
    if (moedasDiferentes && !valor_contraparte) {
      return NextResponse.json({
        error: `Contas em moedas diferentes (${moedaOrigemConta} → ${moedaDestinoConta}). Informe o valor recebido em ${moedaDestinoConta}.`,
      }, { status: 400 })
    }
    const valorContraparte = Number(valor_contraparte) > 0 ? Number(valor_contraparte) : valorConhecido

    // Se já era transferência, desfaz a anterior antes de remarcar
    if (l.transferencia_id) {
      await supabase.from('transacoes').update({ transferencia_id: null }).eq('id', l.id)
      await supabase.from('transacoes').delete().eq('transferencia_id', l.transferencia_id).neq('id', l.id)
      await supabase.from('transferencias').delete().eq('id', l.transferencia_id)
    }

    // origem/destino conforme o sentido do lançamento original.
    // conta_destino_id (parâmetro) é sempre "o outro lado" — onde entra valorContraparte;
    // l.conta_id é sempre o lado conhecido — onde vale valorConhecido.
    const origem = l.tipo === 'debito' ? l.conta_id : conta_destino_id
    const destino = l.tipo === 'debito' ? conta_destino_id : l.conta_id
    const valorNaOrigem = l.tipo === 'debito' ? valorConhecido : valorContraparte
    const valorNaDestino = l.tipo === 'debito' ? valorContraparte : valorConhecido

    const nome = (id: string) => infoPorId.get(id)?.nome ?? 'conta'

    const { data: transf, error: tErr } = await supabase
      .from('transferencias')
      .insert({ conta_origem_id: origem, conta_destino_id: destino, data: l.data, valor: valorNaOrigem, valor_destino: valorNaDestino })
      .select('id').single()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

    // vincula o lançamento original e limpa classificações
    await supabase.from('transacoes')
      .update({ transferencia_id: transf.id, conta_contabil_id: null, cliente_id: null, fornecedor_id: null })
      .eq('id', l.id)

    // cria o espelho na conta de contrapartida (tipo oposto, valor na moeda dela)
    const tipoEspelho = l.tipo === 'debito' ? 'credito' : 'debito'
    await supabase.from('transacoes').insert({
      conta_id: conta_destino_id, data: l.data, valor: valorContraparte, tipo: tipoEspelho, manual: true,
      transferencia_id: transf.id,
      descricao: tipoEspelho === 'credito' ? `Transferência de ${nome(l.conta_id)}` : `Transferência para ${nome(l.conta_id)}`,
    })

    await registrarAtividade(supabase, { acao: 'transferencia', entidade: 'transferencia', entidade_id: transf.id, descricao: `Transferência marcada: ${nome(origem)} → ${nome(destino)} (${valorNaOrigem})`, dados: { valor: valorNaOrigem, valor_destino: valorNaDestino } })
    return NextResponse.json({ id: transf.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// DELETE ?lancamento_id=... — desfaz a transferência mantendo o lançamento
// original do extrato (remove só o espelho e o registro da transferência).
export async function DELETE(req: NextRequest) {
  try {
    const lancamentoId = new URL(req.url).searchParams.get('lancamento_id')
    if (!lancamentoId) return NextResponse.json({ error: 'lancamento_id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()

    const { data: l } = await supabase.from('transacoes').select('id, transferencia_id').eq('id', lancamentoId).single()
    if (!l?.transferencia_id) return NextResponse.json({ ok: true })

    // desvincula o original primeiro (senão o cascade o apagaria)
    await supabase.from('transacoes').update({ transferencia_id: null }).eq('id', l.id)
    await supabase.from('transacoes').delete().eq('transferencia_id', l.transferencia_id).neq('id', l.id)
    await supabase.from('transferencias').delete().eq('id', l.transferencia_id)
    await registrarAtividade(supabase, { acao: 'desfazer_transferencia', entidade: 'transferencia', entidade_id: l.transferencia_id, descricao: 'Transferência desfeita' })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
