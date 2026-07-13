import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterTaxasMensais } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'
import { montarEscopo, criarConversor, distribuirWaterfall, statusReceita, round, hojeISO, mesDe } from '@/lib/planejamento'
import { registrarAtividade } from '@/lib/atividades'

// Trata "tabela ainda não migrada" como conjunto vazio (mesmo padrão de /api/atividades)
const naoMigrada = (msg?: string) => !!msg && /relation .* does not exist|could not find the table/i.test(msg)

type Linha = { id: string; empresa_id: string; cliente_id: string; data_prevista: string; valor_previsto: number; descricao: string | null }

// GET /api/planejamento/receitas?empresas=&moeda=
// Previsões agrupadas por cliente, com valor pago (realizado) conciliado por mês.
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    const escopo = await montarEscopo(supabase, empresaIds, moedaParam)

    const { data: previstoRaw, error } = await supabase
      .from('planejamento_receitas')
      .select('id, empresa_id, cliente_id, data_prevista, valor_previsto, descricao')
      .in('empresa_id', escopo.empresaIds.length ? escopo.empresaIds : ['00000000-0000-0000-0000-000000000000'])
      .order('data_prevista')
    if (error) {
      if (naoMigrada(error.message)) return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, clientes: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const previsto = (previstoRaw ?? []).map((r) => ({ ...r, valor_previsto: Number(r.valor_previsto) })) as Linha[]

    // Clientes envolvidos (nomes)
    const clienteIds = Array.from(new Set(previsto.map((p) => p.cliente_id)))
    const { data: clientesRaw } = clienteIds.length
      ? await supabase.from('clientes').select('id, nome').in('id', clienteIds)
      : { data: [] as { id: string; nome: string }[] }
    const nomeCliente: Record<string, string> = {}
    for (const c of clientesRaw ?? []) nomeCliente[c.id as string] = c.nome as string

    // Realizado: créditos com cliente_id, dentro das contas do escopo, por cliente+mês (convertido)
    const txAll = await selectAll<{ conta_id: string; cliente_id: string | null; data: string; valor: number; tipo: string }>(
      () => supabase.from('transacoes').select('conta_id, cliente_id, data, valor, tipo').eq('tipo', 'credito')
    )
    const txEscopo = txAll.filter((t) => t.cliente_id && escopo.contaIds.has(t.conta_id) && clienteIds.includes(t.cliente_id))

    // Taxas (só se combinada): meses das previsões + das transações
    const meses = new Set<string>()
    for (const p of previsto) meses.add(mesDe(p.data_prevista))
    for (const t of txEscopo) meses.add(mesDe(t.data))
    const taxas = escopo.combinada ? await obterTaxasMensais(Array.from(meses), false) : {}
    const { conv, cambioIndisponivel } = criarConversor(escopo, taxas)

    // realizado[cliente][mes] = soma convertida
    const realizado: Record<string, Record<string, number>> = {}
    for (const t of txEscopo) {
      const m = mesDe(t.data)
      const v = conv(Number(t.valor), escopo.moedaPorConta[t.conta_id], m)
      realizado[t.cliente_id!] ??= {}
      realizado[t.cliente_id!][m] = round((realizado[t.cliente_id!][m] ?? 0) + v)
    }

    const hoje = hojeISO()

    // Agrupa por cliente; converte previsto pela moeda da empresa da linha; concilia por mês (waterfall)
    type LinhaOut = { id: string; data_prevista: string; valor_previsto: number; valor_pago: number; status: string; descricao: string | null }
    const porCliente: Record<string, LinhaOut[]> = {}
    // Agrupa linhas por cliente+mês para o waterfall
    const grupos: Record<string, Linha[]> = {}
    for (const p of previsto) {
      const chave = `${p.cliente_id}|${mesDe(p.data_prevista)}`
      ;(grupos[chave] ??= []).push(p)
    }
    const pagoPorId: Record<string, number> = {}
    for (const [chave, linhas] of Object.entries(grupos)) {
      const [clienteId, mes] = chave.split('|')
      const realizadoMes = realizado[clienteId]?.[mes] ?? 0
      Object.assign(pagoPorId, distribuirWaterfall(linhas, realizadoMes))
    }

    for (const p of previsto) {
      const prevConv = conv(p.valor_previsto, escopo.moedaEmpresa[p.empresa_id] ?? 'BRL', mesDe(p.data_prevista))
      const pago = round(pagoPorId[p.id] ?? 0)
      ;(porCliente[p.cliente_id] ??= []).push({
        id: p.id,
        data_prevista: p.data_prevista,
        valor_previsto: round(prevConv),
        valor_pago: pago,
        status: statusReceita(prevConv, pago, p.data_prevista, hoje),
        descricao: p.descricao,
      })
    }

    const clientes = Object.entries(porCliente).map(([cliente_id, linhas]) => ({
      cliente_id,
      nome: nomeCliente[cliente_id] ?? '—',
      linhas: linhas.sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)),
      total_previsto: round(linhas.reduce((s, l) => s + l.valor_previsto, 0)),
      total_pago: round(linhas.reduce((s, l) => s + l.valor_pago, 0)),
    })).sort((a, b) => a.nome.localeCompare(b.nome))

    return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, cambioIndisponivel, clientes })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST: cria uma ou várias previsões. Body: { empresa_id, cliente_id, data_prevista, valor_previsto, descricao?, repetir?: { meses: number } }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { empresa_id, cliente_id, data_prevista, descricao } = body
    const valor_previsto = Number(body.valor_previsto)
    if (!empresa_id || !cliente_id || !data_prevista) return NextResponse.json({ error: 'empresa_id, cliente_id e data_prevista são obrigatórios' }, { status: 400 })
    if (!Number.isFinite(valor_previsto) || valor_previsto < 0) return NextResponse.json({ error: 'valor_previsto inválido' }, { status: 400 })

    const rows: Record<string, unknown>[] = []
    const nMeses = Math.max(1, Math.min(Number(body?.repetir?.meses) || 1, 60)) // até 60 meses
    const [ano, mes, dia] = data_prevista.split('-').map(Number)
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(ano, (mes - 1) + i, dia)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      rows.push({ empresa_id, cliente_id, data_prevista: iso, valor_previsto, descricao: descricao?.toString().trim() || null })
    }

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase.from('planejamento_receitas').insert(rows).select('id')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await registrarAtividade(supabase, { acao: 'criar_previsao_receita', entidade: 'planejamento_receita', descricao: `Previsão de receita: ${rows.length} lançamento(s)` })
    return NextResponse.json({ ok: true, criados: data?.length ?? 0 })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// PATCH: edita { id, data_prevista?, valor_previsto?, descricao? }
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (body.data_prevista !== undefined) update.data_prevista = body.data_prevista
    if (body.descricao !== undefined) update.descricao = body.descricao?.toString().trim() || null
    if (body.valor_previsto !== undefined) {
      const v = Number(body.valor_previsto)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'valor_previsto inválido' }, { status: 400 })
      update.valor_previsto = v
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('planejamento_receitas').update(update).eq('id', body.id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// DELETE: ?id=
export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('planejamento_receitas').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
