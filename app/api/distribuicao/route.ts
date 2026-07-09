import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterTaxasMensais, converterComTaxas } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'

const round = (x: number) => Math.round(x * 100) / 100

// Ponto mensal de uma série já pronto para acumular:
// - investido/recebido/saldo: na MOEDA DE EXIBIÇÃO da série (local ou comum)
// - netBRL/netUSD: o saldo do mês (investido−recebido) convertido para R$ e US$
//   pela taxa DAQUELE mês (nunca sobre o acumulado).
type MesCalc = { investido: number; recebido: number; netBRL: number; netUSD: number }
type LinhaTimeline = { mes: string; investido: number; recebido: number; saldo: number; acumuladoBRL: number; acumuladoUSD: number }

// Monta a timeline: saldo do mês (moeda de exibição) + dois acumulados
// independentes (R$ e US$), somando os saldos mensais já convertidos mês a mês.
function montarTimeline(meses: string[], porMes: Record<string, MesCalc>): LinhaTimeline[] {
  let accBRL = 0, accUSD = 0
  return meses.map((mes) => {
    const p = porMes[mes] ?? { investido: 0, recebido: 0, netBRL: 0, netUSD: 0 }
    const investido = round(p.investido)
    const recebido = round(p.recebido)
    accBRL = round(accBRL + p.netBRL)
    accUSD = round(accUSD + p.netUSD)
    return { mes, investido, recebido, saldo: round(investido - recebido), acumuladoBRL: accBRL, acumuladoUSD: accUSD }
  })
}

const novoMes = (): MesCalc => ({ investido: 0, recebido: 0, netBRL: 0, netUSD: 0 })

// GET /api/distribuicao?empresas=id1,id2&moeda=USD|BRL
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'BRL' ? 'BRL' : 'USD'

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

    const txs = await selectAll<{ data: string; valor: number; tipo: string; conta_id: string; cliente_id: string | null; fornecedor_id: string | null }>(
      () => supabase.from('transacoes').select('data, valor, tipo, conta_id, cliente_id, fornecedor_id').in('conta_contabil_id', distribIds)
    )
    const txsFiltradas = txs.filter((t) => {
      const emp = empresaDaConta[t.conta_id]
      return !empresaIds.length || empresaIds.includes(emp ?? '')
    })

    const empresasEmUso = Array.from(new Set(txsFiltradas.map((t) => empresaDaConta[t.conta_id]).filter(Boolean)))
    const moedasEmUso = new Set(empresasEmUso.map((id) => moedaEmpresa[id] ?? 'BRL'))
    const combinada = moedasEmUso.size > 1
    const moedaComum: Moeda = combinada ? moedaParam : ((moedaEmpresa[empresasEmUso[0]] as Moeda) ?? 'BRL')

    // Câmbio: sempre necessário porque toda tabela mostra acumulado em R$ E US$.
    // Lê do banco (mesmo critério da DRE — taxa média do mês, sem buscar no request).
    const meses = Array.from(new Set(txsFiltradas.map((t) => t.data.slice(0, 7)))).sort()
    const taxas = await obterTaxasMensais(meses, false)
    const cambioIndisponivel = meses.length > 0 && Object.keys(taxas).length === 0
    const conv = (valor: number, de: Moeda, para: Moeda, mes: string) => converterComTaxas(valor, de, para, mes, taxas)

    // Agregação bruta na moeda nativa: pessoa->empresa->mes e empresa->mes
    type Bruto = { investido: number; recebido: number }
    const porPessoaEmpresa: Record<string, Record<string, Record<string, Bruto>>> = {}
    const porEmpresaMes: Record<string, Record<string, Bruto>> = {}
    const pessoaTipo: Record<string, 'cliente' | 'fornecedor' | 'sem'> = {}
    const pessoaNome: Record<string, string> = {}

    for (const t of txsFiltradas) {
      const emp = empresaDaConta[t.conta_id]
      if (!emp) continue
      const mes = t.data.slice(0, 7)
      const valor = Number(t.valor)
      const pid = t.cliente_id ? `c:${t.cliente_id}` : t.fornecedor_id ? `f:${t.fornecedor_id}` : 'sem'
      pessoaTipo[pid] = t.cliente_id ? 'cliente' : t.fornecedor_id ? 'fornecedor' : 'sem'
      pessoaNome[pid] = pid === 'sem' ? 'Sem cliente/fornecedor' : (nomePessoa[pid] ?? '—')

      const pe = (((porPessoaEmpresa[pid] ??= {})[emp] ??= {})[mes] ??= { investido: 0, recebido: 0 })
      const em = ((porEmpresaMes[emp] ??= {})[mes] ??= { investido: 0, recebido: 0 })
      if (t.tipo === 'credito') { pe.investido += valor; em.investido += valor }
      else { pe.recebido += valor; em.recebido += valor }
    }

    // Série de UMA empresa (moeda local): net convertido para R$ e US$ pela taxa do mês
    const serieEmpresaLocal = (bruto: Record<string, Bruto>, moedaEmp: Moeda): Record<string, MesCalc> => {
      const out: Record<string, MesCalc> = {}
      for (const [mes, b] of Object.entries(bruto)) {
        const net = b.investido - b.recebido
        out[mes] = { investido: b.investido, recebido: b.recebido, netBRL: conv(net, moedaEmp, 'BRL', mes), netUSD: conv(net, moedaEmp, 'USD', mes) }
      }
      return out
    }
    // Série combinando várias empresas: exibição na moedaComum; net por empresa
    // convertido para R$ e US$ e somado por mês.
    const serieCombinada = (empresas: string[], brutoDe: (emp: string) => Record<string, Bruto>): Record<string, MesCalc> => {
      const out: Record<string, MesCalc> = {}
      for (const emp of empresas) {
        const moedaEmp = moedaEmpresa[emp] ?? 'BRL'
        for (const [mes, b] of Object.entries(brutoDe(emp))) {
          const net = b.investido - b.recebido
          const c = (out[mes] ??= novoMes())
          c.investido += conv(b.investido, moedaEmp, moedaComum, mes)
          c.recebido += conv(b.recebido, moedaEmp, moedaComum, mes)
          c.netBRL += conv(net, moedaEmp, 'BRL', mes)
          c.netUSD += conv(net, moedaEmp, 'USD', mes)
        }
      }
      return out
    }

    // Nível Cliente/Fornecedor
    const pessoas = Object.keys(porPessoaEmpresa).map((pid) => {
      const empresasDaPessoa = Object.keys(porPessoaEmpresa[pid])
      const porEmpresa = empresasDaPessoa.map((emp) => ({
        empresaId: emp, empresaNome: nomeEmpresa[emp] ?? '—', moeda: moedaEmpresa[emp] ?? 'BRL',
        timeline: montarTimeline(meses, serieEmpresaLocal(porPessoaEmpresa[pid][emp], moedaEmpresa[emp] ?? 'BRL')),
      }))
      const combinado = { moeda: moedaComum, timeline: montarTimeline(meses, serieCombinada(empresasDaPessoa, (emp) => porPessoaEmpresa[pid][emp])) }
      return { id: pid, nome: pessoaNome[pid], tipo: pessoaTipo[pid], empresas: empresasDaPessoa.length, porEmpresa, combinado }
    }).sort((a, b) => a.nome.localeCompare(b.nome))

    // Nível Empresa (moeda local)
    const porEmpresa = Object.keys(porEmpresaMes).map((emp) => ({
      empresaId: emp, empresaNome: nomeEmpresa[emp] ?? '—', moeda: moedaEmpresa[emp] ?? 'BRL',
      timeline: montarTimeline(meses, serieEmpresaLocal(porEmpresaMes[emp], moedaEmpresa[emp] ?? 'BRL')),
    })).sort((a, b) => a.empresaNome.localeCompare(b.empresaNome))

    // Total Geral (moeda comum)
    const totalGeral = { moeda: moedaComum, timeline: montarTimeline(meses, serieCombinada(Object.keys(porEmpresaMes), (emp) => porEmpresaMes[emp])) }
    const empresas = empresasEmUso.map((id) => ({ id, nome: nomeEmpresa[id] ?? '—', moeda: moedaEmpresa[id] ?? 'BRL' }))

    return NextResponse.json({ moeda: moedaComum, combinada, cambioIndisponivel, meses, empresas, pessoas, porEmpresa, totalGeral })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
