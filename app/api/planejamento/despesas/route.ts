import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterUltimaTaxa } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'
import { montarEscopo, criarConversor, round, mesDe } from '@/lib/planejamento'
import { registrarAtividade } from '@/lib/atividades'

const naoMigrada = (msg?: string) => !!msg && /relation .* does not exist|could not find the table/i.test(msg)

type Linha = { id: string; empresa_id: string; conta_contabil_id: string; mes: string; valor_previsto: number; descricao: string | null }

// GET /api/planejamento/despesas?empresas=&moeda=
// Previsões agrupadas por conta contábil; pago do mês = soma das transações
// classificadas naquela conta contábil (débito positivo, crédito negativo).
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    const escopo = await montarEscopo(supabase, empresaIds, moedaParam)

    const [{ data: previstoRaw, error }, { data: planoRaw }] = await Promise.all([
      supabase
        .from('planejamento_despesas')
        .select('id, empresa_id, conta_contabil_id, mes, valor_previsto, descricao')
        .in('empresa_id', escopo.empresaIds.length ? escopo.empresaIds : ['00000000-0000-0000-0000-000000000000'])
        .order('mes'),
      supabase.from('plano_contas').select('id, codigo, nome'),
    ])
    if (error) {
      if (naoMigrada(error.message)) return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, contas: [] })
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const previsto = (previstoRaw ?? []).map((r) => ({ ...r, valor_previsto: Number(r.valor_previsto) })) as Linha[]

    const infoConta: Record<string, { codigo: string; nome: string }> = {}
    for (const p of planoRaw ?? []) infoConta[p.id as string] = { codigo: p.codigo as string, nome: p.nome as string }

    const contasContabeis = new Set(previsto.map((p) => p.conta_contabil_id))

    // Realizado por conta contábil + mês (net: débito +, crédito −), dentro do escopo
    const txAll = await selectAll<{ conta_id: string; conta_contabil_id: string | null; data: string; valor: number; tipo: string }>(
      () => supabase.from('transacoes').select('conta_id, conta_contabil_id, data, valor, tipo')
    )
    const txEscopo = txAll.filter((t) => t.conta_contabil_id && escopo.contaIds.has(t.conta_id) && contasContabeis.has(t.conta_contabil_id))

    // Câmbio consolidado: última cotação disponível (só se combinada)
    const taxa = escopo.combinada ? await obterUltimaTaxa() : null
    const { conv, cambioIndisponivel } = criarConversor(escopo, taxa)

    // pago[conta][mes]
    const pago: Record<string, Record<string, number>> = {}
    for (const t of txEscopo) {
      const m = mesDe(t.data)
      const sinal = t.tipo === 'debito' ? 1 : -1
      const v = conv(Number(t.valor) * sinal, escopo.moedaPorConta[t.conta_id], m)
      pago[t.conta_contabil_id!] ??= {}
      pago[t.conta_contabil_id!][m] = round((pago[t.conta_contabil_id!][m] ?? 0) + v)
    }

    // Agrega previsto por conta+mes (soma entre empresas, convertendo cada uma)
    type LinhaOut = { ids: string[]; mes: string; valor_previsto: number; valor_pago: number }
    const agregado: Record<string, Record<string, { ids: string[]; previsto: number }>> = {}
    for (const p of previsto) {
      agregado[p.conta_contabil_id] ??= {}
      const cel = (agregado[p.conta_contabil_id][p.mes] ??= { ids: [], previsto: 0 })
      cel.ids.push(p.id)
      cel.previsto = round(cel.previsto + conv(p.valor_previsto, escopo.moedaEmpresa[p.empresa_id] ?? 'BRL', p.mes))
    }

    const contas = Object.entries(agregado).map(([conta_contabil_id, meses]) => {
      const linhas: LinhaOut[] = Object.entries(meses)
        .map(([mes, cel]) => ({ ids: cel.ids, mes, valor_previsto: round(cel.previsto), valor_pago: round(pago[conta_contabil_id]?.[mes] ?? 0) }))
        .sort((a, b) => a.mes.localeCompare(b.mes))
      return {
        conta_contabil_id,
        codigo: infoConta[conta_contabil_id]?.codigo ?? '',
        nome: infoConta[conta_contabil_id]?.nome ?? '—',
        linhas,
        total_previsto: round(linhas.reduce((s, l) => s + l.valor_previsto, 0)),
        total_pago: round(linhas.reduce((s, l) => s + l.valor_pago, 0)),
      }
    }).sort((a, b) => a.codigo.localeCompare(b.codigo, undefined, { numeric: true }))

    return NextResponse.json({ moeda: escopo.moeda, combinada: escopo.combinada, cambioIndisponivel, contas })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST: cria/atualiza previsões por mês. Body: { empresa_id, conta_contabil_id, mes, valor_previsto, descricao?, repetir?: { meses } }
// Upsert em (empresa_id, conta_contabil_id, mes) evita duplicar o mês.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { empresa_id, conta_contabil_id, mes, descricao } = body
    const valor_previsto = Number(body.valor_previsto)
    if (!empresa_id || !conta_contabil_id || !mes) return NextResponse.json({ error: 'empresa_id, conta_contabil_id e mes são obrigatórios' }, { status: 400 })
    if (!/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json({ error: 'mes deve ser YYYY-MM' }, { status: 400 })
    if (!Number.isFinite(valor_previsto) || valor_previsto < 0) return NextResponse.json({ error: 'valor_previsto inválido' }, { status: 400 })

    const nMeses = Math.max(1, Math.min(Number(body?.repetir?.meses) || 1, 60))
    const [ano, mm] = mes.split('-').map(Number)
    const rows: Record<string, unknown>[] = []
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(ano, (mm - 1) + i, 1)
      const isoMes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      rows.push({ empresa_id, conta_contabil_id, mes: isoMes, valor_previsto, descricao: descricao?.toString().trim() || null })
    }

    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('planejamento_despesas').upsert(rows, { onConflict: 'empresa_id,conta_contabil_id,mes' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await registrarAtividade(supabase, { acao: 'criar_previsao_despesa', entidade: 'planejamento_despesa', descricao: `Previsão de despesa: ${rows.length} mês(es)` })
    return NextResponse.json({ ok: true, criados: rows.length })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// PATCH: edita { id, valor_previsto?, descricao? } (ou ids: [] para aplicar a vários)
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const ids: string[] = body.ids ?? (body.id ? [body.id] : [])
    if (!ids.length) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (body.descricao !== undefined) update.descricao = body.descricao?.toString().trim() || null
    if (body.valor_previsto !== undefined) {
      const v = Number(body.valor_previsto)
      if (!Number.isFinite(v) || v < 0) return NextResponse.json({ error: 'valor_previsto inválido' }, { status: 400 })
      update.valor_previsto = v
    }
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('planejamento_despesas').update(update).in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// DELETE: ?id=  ou  ?ids=a,b
export async function DELETE(req: NextRequest) {
  try {
    const sp = new URL(req.url).searchParams
    const ids = (sp.get('ids') ?? sp.get('id') ?? '').split(',').filter(Boolean)
    if (!ids.length) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('planejamento_despesas').delete().in('id', ids)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
