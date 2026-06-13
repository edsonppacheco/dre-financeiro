import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { extrairChave } from '@/lib/classificador-contabil'

// Aprendizado: ao definir a conta contábil de um lançamento, guarda/reforça a
// regra "contraparte -> conta" para classificar lançamentos futuros parecidos.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aprenderRegra(supabase: any, descricao: string, contaContabilId: string) {
  try {
    const chave = extrairChave(descricao)
    if (!chave) return
    const { data: existente } = await supabase.from('regras_classificacao').select('id, ocorrencias').eq('chave', chave).maybeSingle()
    if (existente) {
      await supabase.from('regras_classificacao').update({
        conta_contabil_id: contaContabilId, ocorrencias: existente.ocorrencias + 1, updated_at: new Date().toISOString(),
      }).eq('id', existente.id)
    } else {
      await supabase.from('regras_classificacao').insert({ chave, conta_contabil_id: contaContabilId })
    }
  } catch { /* tabela de regras pode não existir ainda */ }
}

// Aprendizado de cliente/fornecedor: ao vincular uma pessoa a um lançamento,
// guarda/reforça a regra "contraparte -> pessoa" para lançamentos futuros.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function aprenderPessoa(supabase: any, descricao: string, campo: 'cliente_id' | 'fornecedor_id', pessoaId: string) {
  try {
    const chave = extrairChave(descricao)
    if (!chave) return
    const outro = campo === 'cliente_id' ? 'fornecedor_id' : 'cliente_id'
    const { data: existente } = await supabase.from('regras_pessoa').select('id, ocorrencias').eq('chave', chave).maybeSingle()
    if (existente) {
      await supabase.from('regras_pessoa').update({ [campo]: pessoaId, [outro]: null, ocorrencias: existente.ocorrencias + 1, updated_at: new Date().toISOString() }).eq('id', existente.id)
    } else {
      await supabase.from('regras_pessoa').insert({ chave, [campo]: pessoaId })
    }
  } catch { /* tabela pode não existir ainda */ }
}

// PATCH /api/extrato — edita um lançamento (valor, tipo, cliente, fornecedor, conta contábil, descrição)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    // Se for um lançamento de transferência, propaga valor/data aos dois lados
    const { data: atual } = await supabase.from('transacoes').select('transferencia_id').eq('id', body.id).single()
    if (atual?.transferencia_id) {
      const campos: Record<string, unknown> = {}
      if (body.valor !== undefined) {
        const v = Number(body.valor)
        if (isNaN(v) || v <= 0) return NextResponse.json({ error: 'valor inválido' }, { status: 400 })
        campos.valor = v
      }
      if (body.data !== undefined) campos.data = body.data
      if (!Object.keys(campos).length) return NextResponse.json({ error: 'numa transferência só dá para editar valor e data' }, { status: 400 })
      // atualiza os dois lançamentos vinculados e o registro da transferência
      await supabase.from('transacoes').update(campos).eq('transferencia_id', atual.transferencia_id)
      await supabase.from('transferencias').update(campos).eq('id', atual.transferencia_id)
      const { data } = await supabase.from('transacoes').select('id, data, descricao, valor, tipo, manual, transferencia_id').eq('id', body.id).single()
      return NextResponse.json({ lancamento: data, transferencia: true })
    }

    const update: Record<string, unknown> = {}
    if (body.valor !== undefined) {
      const v = Number(body.valor)
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'valor inválido' }, { status: 400 })
      update.valor = v
    }
    if (body.tipo !== undefined) {
      if (!['credito', 'debito'].includes(body.tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
      update.tipo = body.tipo
    }
    if (body.descricao !== undefined) update.descricao = String(body.descricao)
    if (body.cliente_id !== undefined) update.cliente_id = body.cliente_id || null
    if (body.fornecedor_id !== undefined) update.fornecedor_id = body.fornecedor_id || null
    if (body.conta_contabil_id !== undefined) update.conta_contabil_id = body.conta_contabil_id || null
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })

    const { data, error } = await supabase
      .from('transacoes')
      .update(update)
      .eq('id', body.id)
      .select('id, data, descricao, valor, tipo, cliente_id, fornecedor_id, conta_contabil_id, manual')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Aprende as regras quando o usuário define conta contábil ou cliente/fornecedor
    if (data?.descricao) {
      if (body.conta_contabil_id) await aprenderRegra(supabase, data.descricao, body.conta_contabil_id)
      if (body.cliente_id) await aprenderPessoa(supabase, data.descricao, 'cliente_id', body.cliente_id)
      if (body.fornecedor_id) await aprenderPessoa(supabase, data.descricao, 'fornecedor_id', body.fornecedor_id)
    }

    return NextResponse.json({ lancamento: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST /api/extrato — cria um lançamento manual
export async function POST(req: NextRequest) {
  try {
    const b = await req.json()
    if (!b.conta_id || !b.data || !b.descricao || b.valor === undefined || !b.tipo) {
      return NextResponse.json({ error: 'conta_id, data, descrição, valor e tipo são obrigatórios' }, { status: 400 })
    }
    if (!['credito', 'debito'].includes(b.tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
    const valor = Number(b.valor)
    if (isNaN(valor) || valor < 0) return NextResponse.json({ error: 'valor inválido' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('transacoes')
      .insert({
        conta_id: b.conta_id, data: b.data, descricao: String(b.descricao), valor, tipo: b.tipo,
        manual: true,
        conta_contabil_id: b.conta_contabil_id || null,
        cliente_id: b.cliente_id || null,
        fornecedor_id: b.fornecedor_id || null,
      })
      .select('id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: data.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// DELETE /api/extrato?id=... — remove um lançamento
export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()

    // Se for transferência, remove o registro (cascata apaga os dois lançamentos)
    const { data: atual } = await supabase.from('transacoes').select('transferencia_id').eq('id', id).single()
    if (atual?.transferencia_id) {
      const { error } = await supabase.from('transferencias').delete().eq('id', atual.transferencia_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true, transferencia: true })
    }

    const { error } = await supabase.from('transacoes').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// GET /api/extrato?conta_id=... — extrato cronológico de uma conta, com saldo
// calculado (fim do dia) e comparação com o saldo extraído do documento.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const contaId = searchParams.get('conta_id')
    if (!contaId) return NextResponse.json({ error: 'conta_id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    const { data: conta, error: contaErr } = await supabase
      .from('contas')
      .select('id, nome, banco, tipo, saldo_inicial')
      .eq('id', contaId)
      .single()
    if (contaErr) return NextResponse.json({ error: contaErr.message }, { status: 500 })

    const { data: txs, error: txErr } = await supabase
      .from('transacoes')
      .select('id, data, descricao, valor, tipo, cliente_id, fornecedor_id, conta_contabil_id, manual, transferencia_id')
      .eq('conta_id', contaId)
      .order('data', { ascending: true })
      .order('created_at', { ascending: true })
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

    // Conta de contrapartida das transferências (a "conta de pagamento")
    const transfIds = Array.from(new Set((txs ?? []).map((t) => t.transferencia_id).filter(Boolean)))
    const contraparteNome: Record<string, string> = {} // transferencia_id -> nome da outra conta
    if (transfIds.length) {
      const { data: transfs } = await supabase
        .from('transferencias')
        .select('id, conta_origem_id, conta_destino_id, origem:conta_origem_id(nome), destino:conta_destino_id(nome)')
        .in('id', transfIds as string[])
      for (const tr of transfs ?? []) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = tr as any
        contraparteNome[t.id] = t.conta_origem_id === contaId ? (t.destino?.nome ?? '—') : (t.origem?.nome ?? '—')
      }
    }

    // Saldos extraídos do documento (fim de dia), por data
    const { data: saldosDoc } = await supabase
      .from('saldos_extrato')
      .select('data, saldo')
      .eq('conta_id', contaId)
    const saldoDocumentoPorData: Record<string, number> = {}
    for (const s of saldosDoc ?? []) saldoDocumentoPorData[s.data as string] = Number(s.saldo)

    // Saldo calculado acumulado (crédito soma, débito subtrai), a partir do saldo inicial
    let acumulado = Number(conta.saldo_inicial ?? 0)
    const lancamentos = (txs ?? []).map((t) => {
      acumulado += t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
      return {
        ...t,
        valor: Number(t.valor),
        saldo_calculado: Math.round(acumulado * 100) / 100,
        transferencia_contraparte: t.transferencia_id ? contraparteNome[t.transferencia_id] ?? null : null,
      }
    })

    // Saldo calculado de fim de dia = saldo após o último lançamento de cada data
    const saldoCalculadoFimDia: Record<string, number> = {}
    for (const l of lancamentos) saldoCalculadoFimDia[l.data] = l.saldo_calculado

    // Dias com divergência entre calculado e documento
    const alertas: Record<string, { calculado: number; documento: number; diff: number }> = {}
    for (const [data, doc] of Object.entries(saldoDocumentoPorData)) {
      const calc = saldoCalculadoFimDia[data]
      if (calc !== undefined && Math.abs(calc - doc) > 0.005) {
        alertas[data] = { calculado: calc, documento: doc, diff: Math.round((doc - calc) * 100) / 100 }
      }
    }

    // Meses disponíveis (para o filtro de período) e filtro opcional por mês
    const meses = Array.from(new Set(lancamentos.map((l) => l.data.slice(0, 7)))).sort().reverse()
    const mes = searchParams.get('mes')
    const lancamentosFiltrados = mes ? lancamentos.filter((l) => l.data.startsWith(mes)) : lancamentos

    // Dados auxiliares para os dropdowns de edição
    const [plano, clientes, fornecedores] = await Promise.all([
      supabase.from('plano_contas').select('id, codigo, nome, tipo').order('ordem'),
      supabase.from('clientes').select('id, nome').order('nome'),
      supabase.from('fornecedores').select('id, nome').order('nome'),
    ])

    return NextResponse.json({
      conta,
      lancamentos: lancamentosFiltrados,
      meses,
      mes: mes ?? null,
      saldoDocumentoPorData,
      saldoCalculadoFimDia,
      alertas,
      planoContas: plano.data ?? [],
      clientes: clientes.data ?? [],
      fornecedores: fornecedores.data ?? [],
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
