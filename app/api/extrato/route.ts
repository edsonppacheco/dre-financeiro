import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// PATCH /api/extrato — edita um lançamento (valor, tipo, cliente, fornecedor, conta contábil, descrição)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
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

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('transacoes')
      .update(update)
      .eq('id', body.id)
      .select('id, data, descricao, valor, tipo, cliente_id, fornecedor_id, conta_contabil_id, manual')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
      .select('id, data, descricao, valor, tipo, cliente_id, fornecedor_id, conta_contabil_id, manual')
      .eq('conta_id', contaId)
      .order('data', { ascending: true })
      .order('created_at', { ascending: true })
    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })

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
      return { ...t, valor: Number(t.valor), saldo_calculado: Math.round(acumulado * 100) / 100 }
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

    // Dados auxiliares para os dropdowns de edição
    const [plano, clientes, fornecedores] = await Promise.all([
      supabase.from('plano_contas').select('id, codigo, nome, tipo').order('ordem'),
      supabase.from('clientes').select('id, nome').order('nome'),
      supabase.from('fornecedores').select('id, nome').order('nome'),
    ])

    return NextResponse.json({
      conta,
      lancamentos,
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
