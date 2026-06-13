'use client'

import { useCallback, useEffect, useState } from 'react'

type Coluna = { chave: string; label: string }
type LinhaCalc = { codigo: string; nome: string; tipo: string; nivel: number; valores: Record<string, number> }
type Visao = 'ano' | 'trimestres' | 'meses' | 'trimestre' | 'mes'

const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export default function DrePage() {
  const [anos, setAnos] = useState<number[]>([])
  const [ano, setAno] = useState<number | null>(null)
  const [visao, setVisao] = useState<Visao>('meses')
  const [trimestre, setTrimestre] = useState(1)
  const [mesSel, setMesSel] = useState(1)
  const [colunas, setColunas] = useState<Coluna[]>([])
  const [linhas, setLinhas] = useState<LinhaCalc[]>([])
  const [lucroLiquido, setLucroLiquido] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback((anoArg: number | null, v: Visao, t: number, m: number) => {
    const p = new URLSearchParams()
    if (anoArg) p.set('ano', String(anoArg))
    p.set('visao', v)
    if (v === 'trimestre') p.set('trimestre', String(t))
    if (v === 'mes') p.set('mes', String(m))
    fetch(`/api/dre?${p.toString()}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setAnos(d.anos); setAno(d.ano); setColunas(d.colunas); setLinhas(d.linhas); setLucroLiquido(d.lucroLiquido)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

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
    return `/api/exportar?${p.toString()}`
  }

  if (loading && !linhas.length) {
    return <div className="max-w-5xl mx-auto"><div className="animate-pulse space-y-4"><div className="h-8 w-72 bg-slate-200 rounded" /><div className="h-96 bg-slate-100 rounded-xl" /></div></div>
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-bold text-slate-800">DRE — Demonstração do Resultado</h1>
        <p className="text-slate-500 mt-1">Apurada pelo plano de contas, com visão anual, trimestral ou mensal</p>
      </div>

      {/* Controles de visão */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={ano ?? ''} onChange={(e) => recarregar({ ano: Number(e.target.value) })} disabled={!anos.length} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500">
          {anos.length === 0 && <option value="">—</option>}
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select value={visao} onChange={(e) => recarregar({ visao: e.target.value as Visao })} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500">
          <option value="ano">Ano inteiro</option>
          <option value="trimestres">Trimestre a trimestre</option>
          <option value="meses">Mês a mês</option>
          <option value="trimestre">Um trimestre…</option>
          <option value="mes">Um mês…</option>
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

      {colunas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-medium">Sem dados no período</p>
          <p className="text-sm mt-1">Classifique lançamentos no extrato (conta contábil) para gerar a DRE</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium text-left">Conta</th>
                {colunas.map((c) => <th key={c.chave} className="px-4 py-3 font-medium text-right whitespace-nowrap">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l) => {
                const isGrupo = l.tipo === 'grupo'
                const rowCls = isGrupo ? 'bg-slate-50 font-semibold text-slate-700' : 'text-slate-600'
                return (
                  <tr key={l.codigo} className={`border-b border-slate-100 ${rowCls}`}>
                    <td className={`px-4 py-2.5 ${l.nivel === 1 ? 'pl-8' : ''}`}>
                      <span className="text-xs text-slate-400 mr-2 tabular-nums">{l.codigo}</span>{l.nome}
                    </td>
                    {colunas.map((c) => {
                      const v = l.valores[c.chave] ?? 0
                      return <td key={c.chave} className={`px-4 py-2.5 text-right tabular-nums ${v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-slate-300'}`}>{v === 0 ? '—' : fmt(v)}</td>
                    })}
                  </tr>
                )
              })}
              <tr className="bg-blue-50/60 font-bold text-slate-800 border-t-2 border-blue-100">
                <td className="px-4 py-3">Lucro Líquido</td>
                {colunas.map((c) => {
                  const v = lucroLiquido[c.chave] ?? 0
                  return <td key={c.chave} className={`px-4 py-3 text-right tabular-nums ${v < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(v)}</td>
                })}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400 mt-3">
        Valores somados pela conta contábil atribuída no extrato, pela data real de cada lançamento. Receitas positivas; impostos e despesas, negativas.
      </p>
    </div>
  )
}
