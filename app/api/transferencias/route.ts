import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// POST { lancamento_id, conta_destino_id }
// Marca um lançamento JÁ EXISTENTE (que chegou no extrato) como transferência
// para outra conta, criando o lançamento-espelho na conta de contrapartida.
// Não duplica o lançamento original. Limpa cliente/fornecedor/conta contábil.
export async function POST(req: NextRequest) {
  try {
    const { lancamento_id, conta_destino_id } = await req.json()
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

    // Se já era transferência, desfaz a anterior antes de remarcar
    if (l.transferencia_id) {
      await supabase.from('transacoes').update({ transferencia_id: null }).eq('id', l.id)
      await supabase.from('transacoes').delete().eq('transferencia_id', l.transferencia_id).neq('id', l.id)
      await supabase.from('transferencias').delete().eq('id', l.transferencia_id)
    }

    // origem/destino conforme o sentido do lançamento original
    const origem = l.tipo === 'debito' ? l.conta_id : conta_destino_id
    const destino = l.tipo === 'debito' ? conta_destino_id : l.conta_id
    const valor = Number(l.valor)

    const { data: nomes } = await supabase.from('contas').select('id, nome').in('id', [l.conta_id, conta_destino_id])
    const nome = (id: string) => nomes?.find((c) => c.id === id)?.nome ?? 'conta'

    const { data: transf, error: tErr } = await supabase
      .from('transferencias')
      .insert({ conta_origem_id: origem, conta_destino_id: destino, data: l.data, valor })
      .select('id').single()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

    // vincula o lançamento original e limpa classificações
    await supabase.from('transacoes')
      .update({ transferencia_id: transf.id, conta_contabil_id: null, cliente_id: null, fornecedor_id: null })
      .eq('id', l.id)

    // cria o espelho na conta de contrapartida (tipo oposto)
    const tipoEspelho = l.tipo === 'debito' ? 'credito' : 'debito'
    await supabase.from('transacoes').insert({
      conta_id: conta_destino_id, data: l.data, valor, tipo: tipoEspelho, manual: true,
      transferencia_id: transf.id,
      descricao: tipoEspelho === 'credito' ? `Transferência de ${nome(l.conta_id)}` : `Transferência para ${nome(l.conta_id)}`,
    })

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
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
