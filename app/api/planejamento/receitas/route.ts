import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterUltimaTaxa } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'
import { montarEscopo, criarConversor, distribuirWaterfall, statusReceita, round, hojeISO, mesDe } from '@/lib/planejamento'
import { registrarAtividade } from '@/lib/atividades'

// Trata "tabela ainda não migrada" como conjunto vazio (mesmo padrão de /api/atividades)
const naoMigrada = (msg?: string) => !!msg && /relation .* does not exist|could not find the table|column .* does not exist/i.test(msg)

type Linha = { id: string; empresa_id: string; cliente_id: string | null; fornecedor_id: string | null; data_prevista: string; valor_previsto: number; descricao: string | null }
// Chave da contraparte: c:<id> para cliente, f:<id> para fornecedor
const chave = (clienteId: string | null, fornecedorId: string | null) => clienteId ? `c:${clienteId}` : (fornecedorId ? `f:${fornecedorId}` : '')
const tipoDaChave = (k: string): 'cliente' | 'fornecedor' => (k.startsWith('c:') ? 'cliente' : 'fornecedor')
const idDaChave = (k: string) => k.slice(2)

// GET /api/planejamento/receitas?empresas=&moeda=
// Previsões agrupadas por contraparte (cliente ou fornecedor), com valor pago
// (realizado) conciliado por mês.
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    const escopo = await montarEscopo(supabase, empresaIds, moedaParam)

    const { data: previstoRaw, error } = await supabase
      .from('planejamento_receitas')
      .select('id, empresa_id, cliente_id, fornecedor_id, data_prevista, valor_previsto, descricao')
      .in('empresa_id', escopo.empresaIds.length ? escopo.empresaIds : ['00000000-0000-0000-0000-000000000000'])
      .order('data_prevista')
    if (error) {
      if (naoMigrada(error.message)) return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, pessoas: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const previsto = (previstoRaw ?? []).map((r) => ({ ...r, valor_previsto: Number(r.valor_previsto) })) as Linha[]

    // Contrapartes envolvidas (nomes de clientes e fornecedores)
    const clienteIds = Array.from(new Set(previsto.filter((p) => p.cliente_id).map((p) => p.cliente_id as string)))
    const fornecedorIds = Array.from(new Set(previsto.filter((p) => p.fornecedor_id).map((p) => p.fornecedor_id as string)))
    const [{ data: clientesRaw }, { data: fornecedoresRaw }] = await Promise.all([
      clienteIds.length ? supabase.from('clientes').select('id, nome').in('id', clienteIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
      fornecedorIds.length ? supabase.from('fornecedores').select('id, nome').in('id', fornecedorIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    ])
    const nome: Record<string, string> = {}
    for (const c of clientesRaw ?? []) nome[`c:${c.id}`] = c.nome as string
    for (const f of fornecedoresRaw ?? []) nome[`f:${f.id}`] = f.nome as string

    const clienteSet = new Set(clienteIds)
    const fornecedorSet = new Set(fornecedorIds)

    // Realizado: créditos com a contraparte (cliente ou fornecedor), dentro das
    // contas do escopo, por contraparte+mês (convertido).
    const txAll = await selectAll<{ conta_id: string; cliente_id: string | null; fornecedor_id: string | null; data: string; valor: number; tipo: string }>(
      () => supabase.from('transacoes').select('conta_id, cliente_id, fornecedor_id, data, valor, tipo').eq('tipo', 'credito')
    )
    const txEscopo = txAll
      .filter((t) => escopo.contaIds.has(t.conta_id))
      .map((t) => {
        const k = t.cliente_id && clienteSet.has(t.cliente_id) ? `c:${t.cliente_id}` : (t.fornecedor_id && fornecedorSet.has(t.fornecedor_id) ? `f:${t.fornecedor_id}` : '')
        return { ...t, k }
      })
      .filter((t) => t.k)

    // Câmbio consolidado: última cotação disponível (só se combinada)
    const taxa = escopo.combinada ? await obterUltimaTaxa() : null
    const { conv, cambioIndisponivel } = criarConversor(escopo, taxa)

    // realizado[chave][mes] = soma convertida
    const realizado: Record<string, Record<string, number>> = {}
    for (const t of txEscopo) {
      const m = mesDe(t.data)
      const v = conv(Number(t.valor), escopo.moedaPorConta[t.conta_id], m)
      realizado[t.k] ??= {}
      realizado[t.k][m] = round((realizado[t.k][m] ?? 0) + v)
    }

    const hoje = hojeISO()

    // Concilia por contraparte+mês (waterfall)
    const grupos: Record<string, Linha[]> = {}
    for (const p of previsto) {
      const g = `${chave(p.cliente_id, p.fornecedor_id)}|${mesDe(p.data_prevista)}`
      ;(grupos[g] ??= []).push(p)
    }
    const pagoPorId: Record<string, number> = {}
    for (const [g, linhas] of Object.entries(grupos)) {
      const [k, mes] = g.split('|')
      const realizadoMes = realizado[k]?.[mes] ?? 0
      Object.assign(pagoPorId, distribuirWaterfall(linhas, realizadoMes))
    }

    type LinhaOut = { id: string; data_prevista: string; valor_previsto: number; valor_pago: number; status: string; descricao: string | null }
    const porPessoa: Record<string, LinhaOut[]> = {}
    for (const p of previsto) {
      const k = chave(p.cliente_id, p.fornecedor_id)
      const prevConv = conv(p.valor_previsto, escopo.moedaEmpresa[p.empresa_id] ?? 'BRL', mesDe(p.data_prevista))
      const pago = round(pagoPorId[p.id] ?? 0)
      ;(porPessoa[k] ??= []).push({
        id: p.id,
        data_prevista: p.data_prevista,
        valor_previsto: round(prevConv),
        valor_pago: pago,
        status: statusReceita(prevConv, pago, p.data_prevista, hoje),
        descricao: p.descricao,
      })
    }

    const pessoas = Object.entries(porPessoa).map(([k, linhas]) => ({
      pessoa_id: idDaChave(k),
      pessoa_tipo: tipoDaChave(k),
      nome: nome[k] ?? '—',
      linhas: linhas.sort((a, b) => a.data_prevista.localeCompare(b.data_prevista)),
      total_previsto: round(linhas.reduce((s, l) => s + l.valor_previsto, 0)),
      total_pago: round(linhas.reduce((s, l) => s + l.valor_pago, 0)),
    })).sort((a, b) => a.nome.localeCompare(b.nome))

    return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, cambioIndisponivel, pessoas })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST: cria uma ou várias previsões.
// Body: { empresa_id, pessoa_tipo: 'cliente'|'fornecedor', pessoa_id, data_prevista, valor_previsto, descricao?, repetir?: { meses } }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { empresa_id, data_prevista, descricao } = body
    // Compat: aceita pessoa_tipo/pessoa_id ou cliente_id direto
    const pessoaTipo = body.pessoa_tipo ?? (body.cliente_id ? 'cliente' : body.fornecedor_id ? 'fornecedor' : undefined)
    const pessoaId = body.pessoa_id ?? body.cliente_id ?? body.fornecedor_id
    const valor_previsto = Number(body.valor_previsto)
    if (!empresa_id || !pessoaId || !['cliente', 'fornecedor'].includes(pessoaTipo) || !data_prevista) {
      return NextResponse.json({ error: 'empresa_id, contraparte (cliente/fornecedor) e data_prevista são obrigatórios' }, { status: 400 })
    }
    if (!Number.isFinite(valor_previsto) || valor_previsto < 0) return NextResponse.json({ error: 'valor_previsto inválido' }, { status: 400 })

    const fk = pessoaTipo === 'cliente' ? { cliente_id: pessoaId, fornecedor_id: null } : { cliente_id: null, fornecedor_id: pessoaId }

    const rows: Record<string, unknown>[] = []
    const nMeses = Math.max(1, Math.min(Number(body?.repetir?.meses) || 1, 60)) // até 60 meses
    const [ano, mes, dia] = data_prevista.split('-').map(Number)
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(ano, (mes - 1) + i, dia)
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      rows.push({ empresa_id, ...fk, data_prevista: iso, valor_previsto, descricao: descricao?.toString().trim() || null })
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
