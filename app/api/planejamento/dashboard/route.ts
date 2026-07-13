import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { obterTaxasMensais } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'
import { montarEscopo, criarConversor, round, mesDe } from '@/lib/planejamento'

const naoMigrada = (msg?: string) => !!msg && /relation .* does not exist|could not find the table|column .* does not exist/i.test(msg)
const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${NOMES[Number(mm) - 1]}/${a.slice(2)}` }

// GET /api/planejamento/dashboard?meses=3|6|12&empresas=&moeda=
// Previsão de receitas x despesas dos próximos N meses (a partir do mês corrente).
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'
    const nMeses = [3, 6, 12].includes(Number(searchParams.get('meses'))) ? Number(searchParams.get('meses')) : 6

    const escopo = await montarEscopo(supabase, empresaIds, moedaParam)
    const empresaFiltro = escopo.empresaIds.length ? escopo.empresaIds : ['00000000-0000-0000-0000-000000000000']

    // Janela de meses a partir do mês corrente
    const hoje = new Date()
    const janela: string[] = []
    for (let i = 0; i < nMeses; i++) {
      const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1)
      janela.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    }
    const janelaSet = new Set(janela)

    const [rec, desp] = await Promise.all([
      supabase.from('planejamento_receitas').select('empresa_id, cliente_id, fornecedor_id, data_prevista, valor_previsto').in('empresa_id', empresaFiltro),
      supabase.from('planejamento_despesas').select('empresa_id, conta_contabil_id, mes, valor_previsto').in('empresa_id', empresaFiltro),
    ])
    if (rec.error && !naoMigrada(rec.error.message)) return NextResponse.json({ error: rec.error.message }, { status: 500 })
    if (desp.error && !naoMigrada(desp.error.message)) return NextResponse.json({ error: desp.error.message }, { status: 500 })

    // chave da contraparte: c:<id> (cliente) ou f:<id> (fornecedor)
    const receitas = (rec.data ?? []).map((r) => ({
      empresa_id: r.empresa_id as string,
      pessoa: (r.cliente_id ? `c:${r.cliente_id}` : (r.fornecedor_id ? `f:${r.fornecedor_id}` : '')),
      mes: mesDe(r.data_prevista as string),
      valor: Number(r.valor_previsto),
    })).filter((r) => janelaSet.has(r.mes) && r.pessoa)
    const despesas = (desp.data ?? []).map((r) => ({ empresa_id: r.empresa_id as string, conta_contabil_id: r.conta_contabil_id as string, mes: r.mes as string, valor: Number(r.valor_previsto) }))
      .filter((r) => janelaSet.has(r.mes))

    const taxas = escopo.combinada ? await obterTaxasMensais(janela, false) : {}
    const { conv, cambioIndisponivel } = criarConversor(escopo, taxas)

    // Série por mês
    const porMes: Record<string, { receita: number; despesa: number }> = {}
    for (const m of janela) porMes[m] = { receita: 0, despesa: 0 }
    const porPessoa: Record<string, number> = {}
    const porConta: Record<string, number> = {}
    for (const r of receitas) {
      const v = conv(r.valor, escopo.moedaEmpresa[r.empresa_id] ?? 'BRL', r.mes)
      porMes[r.mes].receita = round(porMes[r.mes].receita + v)
      porPessoa[r.pessoa] = round((porPessoa[r.pessoa] ?? 0) + v)
    }
    for (const d of despesas) {
      const v = conv(d.valor, escopo.moedaEmpresa[d.empresa_id] ?? 'BRL', d.mes)
      porMes[d.mes].despesa = round(porMes[d.mes].despesa + v)
      porConta[d.conta_contabil_id] = round((porConta[d.conta_contabil_id] ?? 0) + v)
    }

    // Nomes das contrapartes (clientes/fornecedores) e contas para as listas rápidas
    const clienteIds = Object.keys(porPessoa).filter((k) => k.startsWith('c:')).map((k) => k.slice(2))
    const fornecedorIds = Object.keys(porPessoa).filter((k) => k.startsWith('f:')).map((k) => k.slice(2))
    const contaIds = Object.keys(porConta)
    const [{ data: clientesRaw }, { data: fornecedoresRaw }, { data: planoRaw }] = await Promise.all([
      clienteIds.length ? supabase.from('clientes').select('id, nome').in('id', clienteIds) : Promise.resolve({ data: [] }),
      fornecedorIds.length ? supabase.from('fornecedores').select('id, nome').in('id', fornecedorIds) : Promise.resolve({ data: [] }),
      contaIds.length ? supabase.from('plano_contas').select('id, codigo, nome').in('id', contaIds) : Promise.resolve({ data: [] }),
    ])
    const nomePessoa: Record<string, string> = {}
    for (const c of clientesRaw ?? []) nomePessoa[`c:${c.id}`] = c.nome as string
    for (const f of fornecedoresRaw ?? []) nomePessoa[`f:${f.id}`] = f.nome as string
    const infoConta: Record<string, { codigo: string; nome: string }> = {}
    for (const p of planoRaw ?? []) infoConta[p.id as string] = { codigo: p.codigo as string, nome: p.nome as string }

    const meses = janela.map((m) => ({
      mes: m, label: rotuloMes(m),
      receita: round(porMes[m].receita), despesa: round(porMes[m].despesa),
      saldo: round(porMes[m].receita - porMes[m].despesa),
    }))
    const clientes = Object.entries(porPessoa)
      .map(([k, valor]) => ({ id: k, nome: nomePessoa[k] ?? '—', tipo: k.startsWith('c:') ? 'cliente' : 'fornecedor', valor: round(valor) }))
      .sort((a, b) => b.valor - a.valor)
    const contas = Object.entries(porConta)
      .map(([id, valor]) => ({ id, codigo: infoConta[id]?.codigo ?? '', nome: infoConta[id]?.nome ?? '—', valor: round(valor) }))
      .sort((a, b) => b.valor - a.valor)

    return NextResponse.json({
      moeda: escopo.moeda, combinada: escopo.combinada, cambioIndisponivel, meses: nMeses,
      serie: meses,
      totais: {
        receita: round(meses.reduce((s, m) => s + m.receita, 0)),
        despesa: round(meses.reduce((s, m) => s + m.despesa, 0)),
        saldo: round(meses.reduce((s, m) => s + m.saldo, 0)),
      },
      clientes, contas,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
