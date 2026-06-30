import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterTaxasMensais, converterComTaxas } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'

const round = (x: number) => Math.round(x * 100) / 100

type PontoMes = { investido: number; recebido: number }
type LinhaTimeline = { mes: string; investido: number; recebido: number; saldo: number; acumulado: number }

// Monta a timeline mensal (todos os meses do conjunto, mesmo zerados) com saldo
// e acumulado próprios. `conv` aplica a moeda (identidade na visão local).
function montarTimeline(
  meses: string[],
  porMes: Record<string, PontoMes>,
  conv: (valor: number, mes: string) => number = (v) => v
): LinhaTimeline[] {
  let acumulado = 0
  return meses.map((mes) => {
    const p = porMes[mes] ?? { investido: 0, recebido: 0 }
    const investido = round(conv(p.investido, mes))
    const recebido = round(conv(p.recebido, mes))
    const saldo = round(investido - recebido)
    acumulado = round(acumulado + saldo)
    return { mes, investido, recebido, saldo, acumulado }
  })
}

// Soma um ponto {investido, recebido} num acumulador por mês.
function acumular(dest: Record<string, PontoMes>, mes: string, p: PontoMes) {
  const d = (dest[mes] ??= { investido: 0, recebido: 0 })
  d.investido += p.investido
  d.recebido += p.recebido
}

// GET /api/distribuicao?empresas=id1,id2&moeda=USD|BRL
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'BRL' ? 'BRL' : 'USD'

    // Contas da distribuição (tipo='distribuicao'), empresas e pessoas
    const [{ data: planoRaw }, { data: contasRaw }, { data: empresasRaw }, { data: clientesRaw }, { data: fornecedoresRaw }] = await Promise.all([
      supabase.from('plano_contas').select('id, tipo').eq('tipo', 'distribuicao'),
      supabase.from('contas').select('id, empresa_id'),
      supabase.from('empresas').select('id, nome, moeda'),
      supabase.from('clientes').select('id, nome'),
      supabase.from('fornecedores').select('id, nome'),
    ])

    const distribIds = (planoRaw ?? []).map((p) => p.id as string)
    if (!distribIds.length) {
      return NextResponse.json({ moeda: moedaParam, combinada: false, cambioIndisponivel: false, meses: [], empresas: [], pessoas: [], porEmpresa: [], totalGeral: null })
    }

    const moedaEmpresa: Record<string, Moeda> = {}
    const nomeEmpresa: Record<string, string> = {}
    for (const e of empresasRaw ?? []) { moedaEmpresa[e.id as string] = (e.moeda as Moeda) ?? 'BRL'; nomeEmpresa[e.id as string] = e.nome as string }
    const empresaDaConta: Record<string, string> = {}
    for (const c of contasRaw ?? []) empresaDaConta[c.id as string] = (c.empresa_id as string) ?? ''
    const nomePessoa: Record<string, string> = {}
    for (const p of clientesRaw ?? []) nomePessoa[`c:${p.id}`] = p.nome as string
    for (const p of fornecedoresRaw ?? []) nomePessoa[`f:${p.id}`] = p.nome as string

    // Lançamentos de distribuição (paginado)
    const txs = await selectAll<{ data: string; valor: number; tipo: string; conta_id: string; cliente_id: string | null; fornecedor_id: string | null }>(
      () => supabase.from('transacoes').select('data, valor, tipo, conta_id, cliente_id, fornecedor_id').in('conta_contabil_id', distribIds)
    )

    // Filtra pelas empresas selecionadas (via conta -> empresa)
    const txsFiltradas = txs.filter((t) => {
      const emp = empresaDaConta[t.conta_id]
      return !empresaIds.length || empresaIds.includes(emp ?? '')
    })

    // Empresas em uso e moeda da visão combinada
    const empresasEmUso = Array.from(new Set(txsFiltradas.map((t) => empresaDaConta[t.conta_id]).filter(Boolean)))
    const moedasEmUso = new Set(empresasEmUso.map((id) => moedaEmpresa[id] ?? 'BRL'))
    const combinada = moedasEmUso.size > 1
    const moedaComum: Moeda = combinada ? moedaParam : ((moedaEmpresa[empresasEmUso[0]] as Moeda) ?? 'BRL')

    // Câmbio (lê do banco; mesmo critério da DRE — taxa média do mês)
    const meses = Array.from(new Set(txsFiltradas.map((t) => t.data.slice(0, 7)))).sort()
    const taxas = combinada ? await obterTaxasMensais(meses, false) : {}
    const cambioIndisponivel = combinada && Object.keys(taxas).length === 0
    const convComum = (valor: number, deMoeda: Moeda, mes: string) =>
      combinada ? converterComTaxas(valor, deMoeda, moedaComum, mes, taxas) : valor

    // Estruturas de agregação
    // pessoa -> empresa -> mes -> {investido, recebido}
    const porPessoaEmpresa: Record<string, Record<string, Record<string, PontoMes>>> = {}
    const porEmpresaMes: Record<string, Record<string, PontoMes>> = {}      // empresa -> mes (local)
    const totalGeralMes: Record<string, PontoMes> = {}                       // moeda comum
    const pessoaTipo: Record<string, 'cliente' | 'fornecedor' | 'sem'> = {}
    const pessoaNome: Record<string, string> = {}

    for (const t of txsFiltradas) {
      const emp = empresaDaConta[t.conta_id]
      if (!emp) continue
      const mes = t.data.slice(0, 7)
      const valor = Number(t.valor)
      const ponto: PontoMes = t.tipo === 'credito' ? { investido: valor, recebido: 0 } : { investido: 0, recebido: valor }

      const pid = t.cliente_id ? `c:${t.cliente_id}` : t.fornecedor_id ? `f:${t.fornecedor_id}` : 'sem'
      pessoaTipo[pid] = t.cliente_id ? 'cliente' : t.fornecedor_id ? 'fornecedor' : 'sem'
      pessoaNome[pid] = pid === 'sem' ? 'Sem cliente/fornecedor' : (nomePessoa[pid] ?? '—')

      ;((porPessoaEmpresa[pid] ??= {})[emp] ??= {})
      acumular(porPessoaEmpresa[pid][emp], mes, ponto)
      acumular((porEmpresaMes[emp] ??= {}), mes, ponto)

      const moedaEmp = moedaEmpresa[emp] ?? 'BRL'
      acumular(totalGeralMes, mes, {
        investido: convComum(ponto.investido, moedaEmp, mes),
        recebido: convComum(ponto.recebido, moedaEmp, mes),
      })
    }

    // Nível Cliente/Fornecedor
    const pessoas = Object.keys(porPessoaEmpresa).map((pid) => {
      const empresasDaPessoa = Object.keys(porPessoaEmpresa[pid])
      const porEmpresa = empresasDaPessoa.map((emp) => ({
        empresaId: emp,
        empresaNome: nomeEmpresa[emp] ?? '—',
        moeda: moedaEmpresa[emp] ?? 'BRL',
        timeline: montarTimeline(meses, porPessoaEmpresa[pid][emp]),
      }))
      // Combinado da pessoa: soma das empresas dela, convertida mês a mês
      const combMes: Record<string, PontoMes> = {}
      for (const emp of empresasDaPessoa) {
        const moedaEmp = moedaEmpresa[emp] ?? 'BRL'
        for (const [mes, p] of Object.entries(porPessoaEmpresa[pid][emp])) {
          acumular(combMes, mes, { investido: convComum(p.investido, moedaEmp, mes), recebido: convComum(p.recebido, moedaEmp, mes) })
        }
      }
      return {
        id: pid, nome: pessoaNome[pid], tipo: pessoaTipo[pid],
        empresas: empresasDaPessoa.length,
        porEmpresa,
        combinado: { moeda: moedaComum, timeline: montarTimeline(meses, combMes) },
      }
    }).sort((a, b) => a.nome.localeCompare(b.nome))

    // Nível Empresa (moeda local)
    const porEmpresa = Object.keys(porEmpresaMes).map((emp) => ({
      empresaId: emp,
      empresaNome: nomeEmpresa[emp] ?? '—',
      moeda: moedaEmpresa[emp] ?? 'BRL',
      timeline: montarTimeline(meses, porEmpresaMes[emp]),
    })).sort((a, b) => a.empresaNome.localeCompare(b.empresaNome))

    const totalGeral = { moeda: moedaComum, timeline: montarTimeline(meses, totalGeralMes) }
    const empresas = empresasEmUso.map((id) => ({ id, nome: nomeEmpresa[id] ?? '—', moeda: moedaEmpresa[id] ?? 'BRL' }))

    return NextResponse.json({ moeda: moedaComum, combinada, cambioIndisponivel, meses, empresas, pessoas, porEmpresa, totalGeral })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
