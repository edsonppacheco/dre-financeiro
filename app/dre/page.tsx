'use client'

import { useEffect, useMemo, useState } from 'react'

type LinhaCalc = {
  codigo: string
  nome: string
  tipo: string
  ordem: number
  valor: number
}

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

function rotuloMes(mes: string) {
  const [ano, m] = mes.split('-')
  return `${MESES_PT[Number(m) - 1]} ${ano}`
}

export default function DrePage() {
  const [meses, setMeses] = useState<string[]>([])
  const [mes, setMes] = useState<string | null>(null)
  const [linhas, setLinhas] = useState<LinhaCalc[]>([])
  const [totalTx, setTotalTx] = useState(0)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)

  const carregar = (mesAlvo?: string) => {
    const qs = mesAlvo ? `?mes=${mesAlvo}` : ''
    fetch(`/api/dre${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setMeses(d.meses)
        setMes(d.mes)
        setLinhas(d.linhas)
        setTotalTx(d.totalTransacoes)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  const lucroLiquido = useMemo(
    () => linhas.find((l) => l.codigo === '10')?.valor ?? null,
    [linhas]
  )

  const fmt = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  if (loading && !linhas.length) {
    return (
      <div className="max-w-3xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-72 bg-slate-200 rounded" />
          <div className="h-96 bg-slate-100 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">DRE — Demonstração do Resultado</h1>
          <p className="text-slate-500 mt-1">Visualize e exporte a DRE por período</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={mes ?? ''}
            onChange={(e) => carregar(e.target.value)}
            disabled={!meses.length}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
          >
            {meses.length === 0 && <option value="">Sem dados</option>}
            {meses.map((m) => (
              <option key={m} value={m}>{rotuloMes(m)}</option>
            ))}
          </select>
          {mes && (
            <a
              href={`/api/exportar?mes=${mes}`}
              className="text-sm bg-green-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-green-700 transition-colors whitespace-nowrap"
            >
              ↓ Excel
            </a>
          )}
        </div>
      </div>

      {erro && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {erro}
        </div>
      )}

      {!mes ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">📊</p>
          <p className="font-medium">Nenhum período disponível</p>
          <p className="text-sm mt-1">Envie extratos na tela de upload para gerar a DRE</p>
        </div>
      ) : (
        <>
          {/* Destaque Lucro Líquido */}
          {lucroLiquido !== null && (
            <div className="mb-5 bg-white rounded-xl border border-slate-200 p-5 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Lucro Líquido — {rotuloMes(mes)}</p>
                <p className={`text-3xl font-bold mt-1 ${lucroLiquido >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {fmt(lucroLiquido)}
                </p>
              </div>
              <div className="text-right text-xs text-slate-400">
                <p>{totalTx} transação(ões)</p>
                <p>classificadas no período</p>
              </div>
            </div>
          )}

          {/* Tabela DRE */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                  <th className="px-4 py-3 font-medium w-16">Cód.</th>
                  <th className="px-4 py-3 font-medium">Descrição</th>
                  <th className="px-4 py-3 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => {
                  const isGrupo = l.tipo === 'grupo'
                  const isResultado = l.tipo === 'resultado'
                  const isFolha = !isGrupo && !isResultado
                  const negativo = l.valor < 0

                  let rowCls = ''
                  if (isGrupo) rowCls = 'bg-slate-50 font-semibold text-slate-700'
                  else if (isResultado) rowCls = 'bg-blue-50/60 font-bold text-slate-800 border-y border-blue-100'
                  else rowCls = 'text-slate-600'

                  return (
                    <tr key={l.codigo} className={`border-b border-slate-100 ${rowCls}`}>
                      <td className="px-4 py-2.5 text-xs text-slate-400 tabular-nums">{l.codigo}</td>
                      <td className={`px-4 py-2.5 ${isFolha ? 'pl-8 text-slate-600' : ''}`}>{l.nome}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums ${negativo ? 'text-red-600' : isResultado || isGrupo ? '' : 'text-slate-700'}`}>
                        {l.valor === 0 && isFolha ? <span className="text-slate-300">—</span> : fmt(l.valor)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-slate-400 mt-3">
            Os subtotais (Receita Líquida, Lucro Bruto, Resultado antes do IR, Lucro Líquido) são calculados
            automaticamente a partir das classificações. Correções feitas na tela de revisão já são refletidas aqui.
          </p>
        </>
      )}
    </div>
  )
}
