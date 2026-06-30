'use client'

import { useCallback, useEffect, useState } from 'react'
import { useEmpresas } from '../_components/EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type Linha = { mes: string; investido: number; recebido: number; saldo: number; acumulado: number }
type Serie = { moeda: Moeda; timeline: Linha[] }
type SerieEmpresa = { empresaId: string; empresaNome: string; moeda: Moeda; timeline: Linha[] }
type Pessoa = { id: string; nome: string; tipo: 'cliente' | 'fornecedor' | 'sem'; empresas: number; porEmpresa: SerieEmpresa[]; combinado: Serie }
type Resp = {
  moeda: Moeda
  combinada: boolean
  cambioIndisponivel?: boolean
  meses: string[]
  empresas: { id: string; nome: string; moeda: Moeda }[]
  pessoas: Pessoa[]
  porEmpresa: SerieEmpresa[]
  totalGeral: Serie | null
}

const MESES_PT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${MESES_PT[Number(mm) - 1]}/${a.slice(2)}` }

// Tabela de timeline: linhas = meses (só os com movimento), colunas = métricas.
function TabelaTimeline({ timeline, moeda }: { timeline: Linha[]; moeda: Moeda }) {
  const fmt = (v: number) => fmtMoeda(v, moeda)
  const linhas = timeline.filter((l) => l.investido !== 0 || l.recebido !== 0 || l.acumulado !== 0)
  if (!linhas.length) return <p className="text-xs text-slate-400 px-4 py-3">Sem lançamentos no período.</p>
  const totInv = linhas.reduce((s, l) => s + l.investido, 0)
  const totRec = linhas.reduce((s, l) => s + l.recebido, 0)
  const ultimoAcum = timeline.length ? timeline[timeline.length - 1].acumulado : 0
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide">
          <th className="px-4 py-2 text-left font-medium">Mês</th>
          <th className="px-4 py-2 text-right font-medium">Investido</th>
          <th className="px-4 py-2 text-right font-medium">Recebido</th>
          <th className="px-4 py-2 text-right font-medium">Saldo</th>
          <th className="px-4 py-2 text-right font-medium">Saldo acumulado</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l) => (
          <tr key={l.mes} className="border-b border-slate-100 text-slate-600">
            <td className="px-4 py-2">{rotuloMes(l.mes)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-green-700">{l.investido === 0 ? '—' : fmt(l.investido)}</td>
            <td className="px-4 py-2 text-right tabular-nums text-red-600">{l.recebido === 0 ? '—' : fmt(l.recebido)}</td>
            <td className={`px-4 py-2 text-right tabular-nums ${l.saldo < 0 ? 'text-red-600' : l.saldo > 0 ? 'text-green-700' : 'text-slate-400'}`}>{l.saldo === 0 ? '—' : fmt(l.saldo)}</td>
            <td className={`px-4 py-2 text-right tabular-nums font-medium ${l.acumulado < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(l.acumulado)}</td>
          </tr>
        ))}
        <tr className="border-t border-slate-200 bg-slate-50 font-semibold text-slate-800">
          <td className="px-4 py-2">Total</td>
          <td className="px-4 py-2 text-right tabular-nums text-green-700">{fmt(totInv)}</td>
          <td className="px-4 py-2 text-right tabular-nums text-red-600">{fmt(totRec)}</td>
          <td className={`px-4 py-2 text-right tabular-nums ${totInv - totRec < 0 ? 'text-red-600' : 'text-green-700'}`}>{fmt(totInv - totRec)}</td>
          <td className={`px-4 py-2 text-right tabular-nums ${ultimoAcum < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(ultimoAcum)}</td>
        </tr>
      </tbody>
    </table>
  )
}

export default function DistribuicaoPage() {
  const { selecionadas, combinada: empresasCombinadas, moedaCombinada } = useEmpresas()
  const [d, setD] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [nivel, setNivel] = useState<'pessoa' | 'empresa'>('pessoa')
  const [aberta, setAberta] = useState<Set<string>>(new Set())

  const carregar = useCallback(() => {
    const qs = new URLSearchParams()
    if (selecionadas.length) qs.set('empresas', selecionadas.join(','))
    if (empresasCombinadas) qs.set('moeda', moedaCombinada)
    fetch(`/api/distribuicao?${qs}`)
      .then((r) => r.json())
      .then((x) => { if (x.error) throw new Error(x.error); setD(x) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [selecionadas, empresasCombinadas, moedaCombinada])
  useEffect(() => { carregar() }, [carregar])

  const toggle = (id: string) => setAberta((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
  if (loading || !d) return <div className="animate-pulse space-y-4"><div className="h-8 w-72 bg-slate-200 rounded" /><div className="h-80 bg-slate-100 rounded-xl" /></div>

  const semDados = d.pessoas.length === 0 && d.porEmpresa.length === 0

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Distribuição de Lucros</h1>
          <p className="text-slate-500 mt-1">
            Aportes e distribuições por cliente/fornecedor e empresa, ao longo do tempo
            {d.combinada && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Combinada · convertido para {d.moeda}</span>}
          </p>
        </div>
        <div className="flex rounded-lg border border-slate-300 overflow-hidden text-sm">
          <button onClick={() => setNivel('pessoa')} className={`px-3 py-1.5 font-medium ${nivel === 'pessoa' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Por Cliente/Fornecedor</button>
          <button onClick={() => setNivel('empresa')} className={`px-3 py-1.5 font-medium ${nivel === 'empresa' ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}>Por Empresa</button>
        </div>
      </div>

      {d.cambioIndisponivel && (
        <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-3">
          ⚠ Câmbio não disponível para o total combinado. Os valores convertidos podem estar incompletos.
          Vá em <a href="/configuracoes" className="underline font-medium">Configurações → Câmbio</a> e clique em &quot;Atualizar câmbio&quot;.
        </div>
      )}

      <p className="text-xs text-slate-400 mb-3">
        Investido = aportes (entrada de capital). Recebido = distribuições (saída de lucro). Saldo = Investido − Recebido.
      </p>

      {semDados ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">📈</p>
          <p className="font-medium">Sem lançamentos de distribuição de lucros</p>
          <p className="text-sm mt-1">Classifique transações na conta contábil &quot;Distribuição de lucros&quot;.</p>
        </div>
      ) : nivel === 'pessoa' ? (
        <div className="space-y-2">
          {d.pessoas.map((p) => {
            const aberto = aberta.has(p.id)
            return (
              <div key={p.id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <button onClick={() => toggle(p.id)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 text-left">
                  <span className="flex items-center gap-2">
                    <span className="text-slate-400 text-xs">{aberto ? '▾' : '▸'}</span>
                    <span className="font-medium text-slate-700">{p.nome}</span>
                    <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">{p.tipo === 'cliente' ? 'Cliente' : p.tipo === 'fornecedor' ? 'Fornecedor' : '—'}</span>
                    {p.empresas > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-600">{p.empresas} empresas</span>}
                  </span>
                  <span className="text-sm tabular-nums text-slate-500">
                    Acum.: {fmtMoeda(p.combinado.timeline.at(-1)?.acumulado ?? 0, p.combinado.moeda)}
                  </span>
                </button>
                {aberto && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100">
                    {p.porEmpresa.map((e) => (
                      <div key={e.empresaId}>
                        <div className="px-4 py-2 text-xs font-semibold text-slate-500 bg-slate-50/60">{e.empresaNome} · {e.moeda} <span className="font-normal text-slate-400">(moeda local)</span></div>
                        <TabelaTimeline timeline={e.timeline} moeda={e.moeda} />
                      </div>
                    ))}
                    {p.empresas > 1 && (
                      <div>
                        <div className="px-4 py-2 text-xs font-semibold text-violet-700 bg-violet-50/60">Combinado em {p.combinado.moeda} <span className="font-normal text-violet-500">(câmbio médio mensal)</span></div>
                        <TabelaTimeline timeline={p.combinado.timeline} moeda={p.combinado.moeda} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="space-y-4">
          {d.porEmpresa.map((e) => (
            <div key={e.empresaId} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="px-4 py-2.5 border-b border-slate-100 text-sm font-semibold text-slate-700">{e.empresaNome} <span className="text-slate-400 font-normal">· {e.moeda} (moeda local)</span></div>
              <TabelaTimeline timeline={e.timeline} moeda={e.moeda} />
            </div>
          ))}
        </div>
      )}

      {/* Total Geral — destaque ao final */}
      {d.totalGeral && !semDados && (
        <div className="mt-6 bg-white rounded-xl border-2 border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-800 text-white text-sm font-semibold flex items-center justify-between">
            <span>Total Geral — todas as empresas e pessoas</span>
            <span className="text-xs font-normal text-slate-300">convertido para {d.totalGeral.moeda}</span>
          </div>
          <TabelaTimeline timeline={d.totalGeral.timeline} moeda={d.totalGeral.moeda} />
        </div>
      )}
    </div>
  )
}
