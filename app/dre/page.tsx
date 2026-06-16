'use client'

import { useCallback, useEffect, useState } from 'react'
import { useEmpresas } from '../_components/EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type Coluna = { chave: string; label: string }
type LinhaCalc = { codigo: string; nome: string; tipo: string; nivel: number; valores: Record<string, number> }
type Visao = 'ano' | 'trimestres' | 'meses' | 'trimestre' | 'mes' | 'anos'
type BalancoCol = { contasCorrentes: number; cartoes: number; emprestimos: number; capitalInicial: number; lucroLiquido: number; lucrosDistribuidos: number; lucrosRetidos: number; ajusteCambial: number; totalAtivos: number; totalPassivosPL: number }
type SerieCol = { distribuicaoMes: number; recebimentoEmprestimos: number; pagamentoEmprestimos: number }
type TransfRef = { data: string; contaOrigem: string; contaDestino: string; valorOrigem: number; moedaOrigem: Moeda; valorDestino: number; moedaDestino: Moeda }

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const fmtDataRef = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }
const TOTAL = '__total__'

export default function RelatoriosPage() {
  const { selecionadas, combinada: empresasCombinadas, moedaCombinada } = useEmpresas()
  const [anos, setAnos] = useState<number[]>([])
  const [ano, setAno] = useState<number | null>(null)
  const [visao, setVisao] = useState<Visao>('meses')
  const [trimestre, setTrimestre] = useState(1)
  const [mesSel, setMesSel] = useState(1)
  const [colunas, setColunas] = useState<Coluna[]>([])
  const [linhas, setLinhas] = useState<LinhaCalc[]>([])
  const [lucroLiquido, setLucroLiquido] = useState<Record<string, number>>({})
  const [balanco, setBalanco] = useState<Record<string, BalancoCol>>({})
  const [serie, setSerie] = useState<Record<string, SerieCol>>({})
  const [moeda, setMoeda] = useState<Moeda>('BRL')
  const [combinada, setCombinada] = useState(false)
  const [cambioIndisponivel, setCambioIndisponivel] = useState(false)
  const [transferenciasReferencia, setTransferenciasReferencia] = useState<TransfRef[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const fmt = useCallback((v: number) => fmtMoeda(v, moeda), [moeda])

  const carregar = useCallback((anoArg: number | null, v: Visao, t: number, m: number) => {
    const p = new URLSearchParams()
    if (anoArg) p.set('ano', String(anoArg))
    p.set('visao', v)
    if (v === 'trimestre') p.set('trimestre', String(t))
    if (v === 'mes') p.set('mes', String(m))
    if (selecionadas.length) p.set('empresas', selecionadas.join(','))
    if (empresasCombinadas) p.set('moeda', moedaCombinada)
    fetch(`/api/dre?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setAnos(d.anos); setAno(d.ano); setColunas(d.colunas); setLinhas(d.linhas)
        setLucroLiquido(d.lucroLiquido); setBalanco(d.balanco ?? {}); setSerie(d.serie ?? {})
        setMoeda(d.moeda ?? 'BRL'); setCombinada(!!d.combinada); setCambioIndisponivel(!!d.cambioIndisponivel); setTransferenciasReferencia(d.transferenciasReferencia ?? [])
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [selecionadas, empresasCombinadas, moedaCombinada])

  useEffect(() => { carregar(null, 'meses', 1, 1) }, [carregar])

  const recarregar = (over: Partial<{ ano: number; visao: Visao; trimestre: number; mesSel: number }>) => {
    const a = over.ano ?? ano, v = over.visao ?? visao, t = over.trimestre ?? trimestre, m = over.mesSel ?? mesSel
    if (over.ano !== undefined) setAno(over.ano)
    if (over.visao !== undefined) setVisao(over.visao)
    if (over.trimestre !== undefined) setTrimestre(over.trimestre)
    if (over.mesSel !== undefined) setMesSel(over.mesSel)
    carregar(a, v, t, m)
  }

  const expUrl = () => {
    const p = new URLSearchParams()
    if (ano) p.set('ano', String(ano))
    p.set('visao', visao)
    if (visao === 'trimestre') p.set('trimestre', String(trimestre))
    if (visao === 'mes') p.set('mes', String(mesSel))
    if (selecionadas.length) p.set('empresas', selecionadas.join(','))
    if (empresasCombinadas) p.set('moeda', moedaCombinada)
    return `/api/exportar?${p.toString()}`
  }

  // Coluna de total do período (só quando há mais de uma coluna)
  const temTotal = colunas.length > 1
  const cols: Coluna[] = temTotal ? [...colunas, { chave: TOTAL, label: 'Total' }] : colunas
  const chaves = colunas.map((c) => c.chave)
  const ultima = colunas[colunas.length - 1]?.chave
  const primeira = colunas[0]?.chave

  const somaCols = (get: (k: string) => number) => chaves.reduce((s, k) => s + (get(k) || 0), 0)
  // DRE / lucro líquido / série: total = soma; balanço (saldos): total = última coluna
  const valDRE = (l: LinhaCalc, k: string) => k === TOTAL ? somaCols((kk) => l.valores[kk] ?? 0) : (l.valores[k] ?? 0)
  const valLL = (k: string) => k === TOTAL ? somaCols((kk) => lucroLiquido[kk] ?? 0) : (lucroLiquido[k] ?? 0)
  const valSerie = (f: keyof SerieCol, k: string) => k === TOTAL ? somaCols((kk) => serie[kk]?.[f] ?? 0) : (serie[k]?.[f] ?? 0)
  const valBal = (f: keyof BalancoCol, k: string) => {
    if (k !== TOTAL) return balanco[k]?.[f] ?? 0
    // Total: saldos = fim do período (última coluna); fluxos = soma/início
    if (f === 'lucroLiquido') return somaCols((kk) => balanco[kk]?.lucroLiquido ?? 0)
    if (f === 'lucrosRetidos') return balanco[primeira]?.lucrosRetidos ?? 0
    if (f === 'totalPassivosPL') {
      const b = balanco[ultima]
      return -(b?.emprestimos ?? 0) - (b?.cartoes ?? 0) + (b?.capitalInicial ?? 0) + somaCols((kk) => balanco[kk]?.lucroLiquido ?? 0) + (balanco[primeira]?.lucrosRetidos ?? 0) - (b?.lucrosDistribuidos ?? 0) + (b?.ajusteCambial ?? 0)
    }
    return balanco[ultima]?.[f] ?? 0 // contasCorrentes, cartoes, emprestimos, capitalInicial, lucrosDistribuidos, totalAtivos
  }

  const cellCls = (v: number) => v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-slate-300'
  const num = (v: number) => v === 0 ? '—' : fmt(v)

  if (loading && !linhas.length) {
    return <div className="max-w-6xl mx-auto"><div className="animate-pulse space-y-4"><div className="h-8 w-80 bg-slate-200 rounded" /><div className="h-96 bg-slate-100 rounded-xl" /></div></div>
  }

  const thCls = (k: string) => `px-4 py-3 font-medium text-right whitespace-nowrap ${k === TOTAL ? 'bg-slate-100 text-slate-700' : ''}`
  const tdCls = (k: string) => `px-4 py-2.5 text-right tabular-nums ${k === TOTAL ? 'bg-slate-50 font-semibold' : ''}`

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800">Relatórios Financeiros</h1>
        <p className="text-slate-500 mt-1">
          DRE e Balanço pelo plano de contas, por período
          {combinada && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Combinada · convertido para {moeda}</span>}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={ano ?? ''} onChange={(e) => recarregar({ ano: Number(e.target.value) })} disabled={!anos.length || visao === 'anos'} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50">
          {anos.length === 0 && <option value="">—</option>}
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={visao} onChange={(e) => recarregar({ visao: e.target.value as Visao })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500">
          <option value="ano">Ano inteiro</option>
          <option value="trimestres">Trimestre a trimestre</option>
          <option value="meses">Mês a mês</option>
          <option value="trimestre">Um trimestre…</option>
          <option value="mes">Um mês…</option>
          <option value="anos">Plurianual (até 5 anos)</option>
        </select>
        {visao === 'trimestre' && (
          <select value={trimestre} onChange={(e) => recarregar({ trimestre: Number(e.target.value) })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            {[1, 2, 3, 4].map((q) => <option key={q} value={q}>{q}º trimestre</option>)}
          </select>
        )}
        {visao === 'mes' && (
          <select value={mesSel} onChange={(e) => recarregar({ mesSel: Number(e.target.value) })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white">
            {MESES_PT.map((nome, i) => <option key={i} value={i + 1}>{nome}</option>)}
          </select>
        )}
        <a href={expUrl()} className="ml-auto text-sm bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 whitespace-nowrap">↓ Excel</a>
      </div>

      {erro && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}

      {cambioIndisponivel && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          ⚠ Câmbio não disponível para a conversão combinada. Os valores <strong>não estão convertidos</strong>.
          Vá em <a href="/configuracoes" className="underline font-medium">Configurações → Câmbio</a> e clique em &quot;Atualizar câmbio&quot;.
        </div>
      )}

      {colunas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-medium">Sem dados no período</p>
          <p className="text-sm mt-1">Classifique lançamentos no extrato (conta contábil) para gerar os relatórios</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium text-left">Conta</th>
                {cols.map((c) => <th key={c.chave} className={thCls(c.chave)}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {/* DRE */}
              <tr className="bg-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wide"><td className="px-4 py-1.5" colSpan={cols.length + 1}>Demonstração do Resultado</td></tr>
              {linhas.map((l) => {
                const isGrupo = l.tipo === 'grupo'
                return (
                  <tr key={l.codigo} className={`border-b border-slate-100 ${isGrupo ? 'bg-slate-50 font-semibold text-slate-700' : 'text-slate-600'}`}>
                    <td className={`px-4 py-2.5 ${l.nivel === 1 ? 'pl-8' : ''}`}><span className="text-xs text-slate-400 mr-2 tabular-nums">{l.codigo}</span>{l.nome}</td>
                    {cols.map((c) => { const v = valDRE(l, c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${cellCls(v)}`}>{num(v)}</td> })}
                  </tr>
                )
              })}
              <tr className="bg-blue-50/60 font-bold text-slate-800 border-y border-blue-100">
                <td className="px-4 py-3">Lucro Líquido</td>
                {cols.map((c) => { const v = valLL(c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${v < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(v)}</td> })}
              </tr>

              {/* Movimentações do período (séries) */}
              <tr className="bg-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wide"><td className="px-4 py-1.5" colSpan={cols.length + 1}>Movimentações do período</td></tr>
              {([
                ['Distribuição de lucros', 'distribuicaoMes'],
                ['Recebimento de empréstimos', 'recebimentoEmprestimos'],
                ['Pagamento de empréstimos', 'pagamentoEmprestimos'],
              ] as [string, keyof SerieCol][]).map(([label, f]) => (
                <tr key={f} className="border-b border-slate-100 text-slate-600">
                  <td className="px-4 py-2.5">{label}</td>
                  {cols.map((c) => { const v = valSerie(f, c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} text-slate-700`}>{v === 0 ? '—' : fmt(v)}</td> })}
                </tr>
              ))}

              {/* Balanço */}
              <tr className="bg-slate-100 text-[11px] font-bold text-slate-500 uppercase tracking-wide"><td className="px-4 py-1.5" colSpan={cols.length + 1}>Balanço Patrimonial (fim do período)</td></tr>
              <tr className="text-[11px] font-semibold text-slate-500 uppercase"><td className="px-4 py-1.5">Ativos</td>{cols.map((c) => <td key={c.chave} className={tdCls(c.chave)} />)}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Saldo em contas correntes</td>{cols.map((c) => { const v = valBal('contasCorrentes', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${cellCls(v)}`}>{num(v)}</td> })}</tr>
              <tr className="border-b border-slate-200 font-semibold text-slate-800"><td className="px-4 py-2.5">Total de ativos</td>{cols.map((c) => { const v = valBal('totalAtivos', c.chave); return <td key={c.chave} className={tdCls(c.chave)}>{fmt(v)}</td> })}</tr>
              <tr className="text-[11px] font-semibold text-slate-500 uppercase"><td className="px-4 py-1.5">Passivos e Patrimônio</td>{cols.map((c) => <td key={c.chave} className={tdCls(c.chave)} />)}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Empréstimos (a pagar)</td>{cols.map((c) => { const v = -valBal('emprestimos', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${v > 0 ? 'text-red-600' : 'text-slate-300'}`}>{v === 0 ? '—' : fmt(v)}</td> })}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Cartões (a pagar)</td>{cols.map((c) => { const v = -valBal('cartoes', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${v > 0 ? 'text-red-600' : 'text-slate-300'}`}>{v === 0 ? '—' : fmt(v)}</td> })}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Capital inicial</td>{cols.map((c) => { const v = valBal('capitalInicial', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} text-slate-700`}>{num(v)}</td> })}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Lucro líquido (período)</td>{cols.map((c) => { const v = valBal('lucroLiquido', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${cellCls(v)}`}>{num(v)}</td> })}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">Lucros retidos (acumulado)</td>{cols.map((c) => { const v = valBal('lucrosRetidos', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${cellCls(v)}`}>{num(v)}</td> })}</tr>
              <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8">(−) Lucros distribuídos (acumulado)</td>{cols.map((c) => { const v = valBal('lucrosDistribuidos', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${v > 0 ? 'text-red-600' : 'text-slate-300'}`}>{v === 0 ? '—' : '-' + fmt(v)}</td> })}</tr>
              {combinada && (
                <tr className="border-b border-slate-100 text-slate-600"><td className="px-4 py-2.5 pl-8" title="Diferença de conversão das moedas (saldos a câmbio de fechamento; fluxos a câmbio do mês). Vai no patrimônio, não no resultado.">Ajuste de conversão cambial</td>{cols.map((c) => { const v = valBal('ajusteCambial', c.chave); return <td key={c.chave} className={`${tdCls(c.chave)} ${cellCls(v)}`}>{num(v)}</td> })}</tr>
              )}
              <tr className="border-b border-slate-200 font-semibold text-slate-800"><td className="px-4 py-2.5">Total passivos + patrimônio</td>{cols.map((c) => { const v = valBal('totalPassivosPL', c.chave); const ok = Math.abs(v - valBal('totalAtivos', c.chave)) < 0.01; return <td key={c.chave} className={`${tdCls(c.chave)} ${ok ? '' : 'text-amber-600'}`} title={ok ? 'Confere com o ativo' : 'Difere do ativo'}>{fmt(v)}</td> })}</tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Transferências entre empresas — referência, não entram na DRE */}
      {combinada && transferenciasReferencia.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mt-4">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">
            Movimentações entre empresas <span className="font-normal">(referência — não entram na DRE)</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {transferenciasReferencia.map((t, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">{fmtDataRef(t.data)} · {t.contaOrigem} → {t.contaDestino}</span>
                <span className="text-slate-500 tabular-nums">
                  {fmtMoeda(t.valorOrigem, t.moedaOrigem)} → {fmtMoeda(t.valorDestino, t.moedaDestino)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Valores pela conta contábil atribuída no extrato e pela data real de cada lançamento. Distribuição de lucros não entra na DRE
        (aparece em Movimentações e reduz o patrimônio no Balanço). Empréstimos/cartões entram no Balanço como saldo. A coluna “Total”
        soma os fluxos do período; no Balanço mostra a posição no fim do período.
        {combinada && ' Valores convertidos pela média mensal do câmbio (saldos pela taxa de fechamento do período).'}
      </p>
    </div>
  )
}
