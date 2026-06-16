'use client'

import { useCallback, useEffect, useState } from 'react'
import { useEmpresas } from './_components/EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type Conta = { nome: string; tipo: string; saldo: number }
type MesData = { label: string; receita: number; despesa: number }
type Ytd = { label: string; receita: number; despesa: number; lucro: number }
type Ponto = { label: string; receita: number; despesa: number; lucro: number }
type TransfRef = { data: string; contaOrigem: string; contaDestino: string; valorOrigem: number; moedaOrigem: Moeda; valorDestino: number; moedaDestino: Moeda }
type Dash = {
  moeda: Moeda
  combinada: boolean
  ultimaAtualizacao: string | null
  contas: Conta[]
  saldoTotal: number
  dividasLongoPrazo: number
  saldoCartoes: number
  esteMes: MesData
  mesPassado: MesData
  mesAnterior: MesData
  ytd: { atual: Ytd; anterior: Ytd }
  pontos: Ponto[]
  transferenciasReferencia: TransfRef[]
}

const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }
const pct = (atual: number, base: number) => base === 0 ? null : ((atual - base) / Math.abs(base)) * 100

const VISOES: [string, string][] = [
  ['mes', 'Mês a mês'], ['trimestre', 'Trimestre a trimestre'], ['ano', 'Ano a ano'],
  ['este_ano', 'Este ano'], ['ano_passado', 'Ano passado até o mês'], ['ultimo_ano', 'Últimos 12 meses'],
]

function Variacao({ atual, base }: { atual: number; base: number }) {
  const p = pct(atual, base)
  if (p === null) return <span className="text-xs text-slate-400">—</span>
  const pos = p >= 0
  return <span className={`text-xs font-medium ${pos ? 'text-green-600' : 'text-red-600'}`}>{pos ? '▲' : '▼'} {Math.abs(p).toFixed(1)}%</span>
}

function Card({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{titulo}</p>
      <div className="mt-2">{children}</div>
    </div>
  )
}

function Grafico({ pontos }: { pontos: Ponto[] }) {
  if (!pontos.length) return <p className="text-sm text-slate-400 py-8 text-center">Sem dados no período</p>
  const W = Math.max(640, pontos.length * 64), H = 240, pad = { t: 16, b: 28, l: 8, r: 8 }
  const max = Math.max(1, ...pontos.flatMap((p) => [p.receita, p.despesa, p.lucro]))
  const min = Math.min(0, ...pontos.map((p) => p.lucro))
  const range = max - min
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (max - v) / range
  const y0 = y(0)
  const slot = (W - pad.l - pad.r) / pontos.length
  const bw = Math.min(18, slot * 0.28)
  const linePts = pontos.map((p, i) => `${pad.l + slot * (i + 0.5)},${y(p.lucro)}`).join(' ')
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="max-w-full">
        <line x1={pad.l} y1={y0} x2={W - pad.r} y2={y0} stroke="#cbd5e1" strokeWidth="1" />
        {pontos.map((p, i) => {
          const cx = pad.l + slot * (i + 0.5)
          return (
            <g key={i}>
              <rect x={cx - bw - 2} y={y(p.receita)} width={bw} height={Math.abs(y0 - y(p.receita))} fill="#16a34a" rx="2" />
              <rect x={cx + 2} y={y(p.despesa)} width={bw} height={Math.abs(y0 - y(p.despesa))} fill="#dc2626" rx="2" />
              <text x={cx} y={H - 10} textAnchor="middle" fontSize="10" fill="#64748b">{p.label}</text>
            </g>
          )
        })}
        <polyline points={linePts} fill="none" stroke="#1e3a5f" strokeWidth="2" />
        {pontos.map((p, i) => <circle key={i} cx={pad.l + slot * (i + 0.5)} cy={y(p.lucro)} r="3" fill="#1e3a5f" />)}
      </svg>
      <div className="flex gap-4 text-xs text-slate-500 mt-1 px-2">
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-600 rounded-sm inline-block" /> Receitas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-600 rounded-sm inline-block" /> Despesas</span>
        <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-slate-700 inline-block" /> Lucro líquido</span>
      </div>
    </div>
  )
}

export default function PainelPage() {
  const { selecionadas, combinada: empresasCombinadas, moedaCombinada } = useEmpresas()
  const [d, setD] = useState<Dash | null>(null)
  const [visao, setVisao] = useState('mes')
  const [erro, setErro] = useState<string | null>(null)

  const carregar = useCallback((v: string) => {
    const qs = new URLSearchParams({ visao: v })
    if (selecionadas.length) qs.set('empresas', selecionadas.join(','))
    if (empresasCombinadas) qs.set('moeda', moedaCombinada)
    fetch(`/api/dashboard?${qs}`).then((r) => r.json()).then((x) => { if (x.error) throw new Error(x.error); setD(x) }).catch((e) => setErro(e.message))
  }, [selecionadas, empresasCombinadas, moedaCombinada])
  useEffect(() => { carregar(visao) }, [visao, carregar])

  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
  if (!d) return <div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-slate-200 rounded" /><div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-slate-100 rounded-xl" />)}</div></div>

  const ll = (y: Ytd) => y.receita - y.despesa
  const fmt = (v: number) => fmtMoeda(v, d.moeda)

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Painel</h1>
          <p className="text-slate-500 mt-1">
            Visão geral das finanças
            {d.combinada && <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-violet-100 text-violet-700">Combinada · convertido para {d.moeda}</span>}
          </p>
        </div>
        <p className="text-xs text-slate-400">Última atualização: {d.ultimaAtualizacao ? fmtData(d.ultimaAtualizacao) : '—'}</p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        <Card titulo="Saldo total (contas correntes)"><p className={`text-3xl font-bold ${d.saldoTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.saldoTotal)}</p></Card>
        <Card titulo="Dívidas de longo prazo (empréstimos)"><p className={`text-3xl font-bold ${d.dividasLongoPrazo < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.dividasLongoPrazo)}</p></Card>
        <Card titulo="Cartões (saldo)"><p className={`text-3xl font-bold ${d.saldoCartoes < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.saldoCartoes)}</p></Card>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-6">
        <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">Saldo nas contas</div>
        <div className="divide-y divide-slate-100">
          {d.contas.length === 0 ? <p className="px-4 py-4 text-sm text-slate-400">Nenhuma conta cadastrada</p> : d.contas.map((c, i) => (
            <div key={i} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span className="text-slate-600">{c.tipo === 'cartao' ? '💳' : c.tipo === 'emprestimo' ? '💰' : '🏦'} {c.nome}</span>
              <span className={`font-medium tabular-nums ${c.saldo < 0 ? 'text-red-600' : 'text-slate-700'}`}>{fmt(c.saldo)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Card titulo={`Receita — ${d.mesPassado.label}`}>
          <div className="flex items-end justify-between"><p className="text-2xl font-bold text-green-600">{fmt(d.mesPassado.receita)}</p><Variacao atual={d.mesPassado.receita} base={d.mesAnterior.receita} /></div>
          <p className="text-xs text-slate-400 mt-1">vs {d.mesAnterior.label}: {fmt(d.mesAnterior.receita)}</p>
        </Card>
        <Card titulo={`Despesas — ${d.mesPassado.label}`}>
          <div className="flex items-end justify-between"><p className="text-2xl font-bold text-red-600">{fmt(d.mesPassado.despesa)}</p><Variacao atual={d.mesPassado.despesa} base={d.mesAnterior.despesa} /></div>
          <p className="text-xs text-slate-400 mt-1">vs {d.mesAnterior.label}: {fmt(d.mesAnterior.despesa)}</p>
        </Card>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Este mês ({d.esteMes.label}) — parcial</p>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-xs text-slate-400">Receitas</p><p className="text-xl font-bold text-green-600">{fmt(d.esteMes.receita)}</p></div>
          <div><p className="text-xs text-slate-400">Despesas</p><p className="text-xl font-bold text-red-600">{fmt(d.esteMes.despesa)}</p></div>
          <div><p className="text-xs text-slate-400">Resultado</p><p className={`text-xl font-bold ${d.esteMes.receita - d.esteMes.despesa < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.esteMes.receita - d.esteMes.despesa)}</p></div>
        </div>
      </div>

      {/* Comparativo anual (YTD) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Ano até o mês — {d.ytd.atual.label} vs {d.ytd.anterior.label}</p>
        <div className="grid grid-cols-3 gap-4 text-sm">
          {([['Receitas', 'receita', 'text-green-600'], ['Despesas', 'despesa', 'text-red-600'], ['Lucro líquido', 'lucro', 'text-slate-800']] as [string, keyof Ytd, string][]).map(([lab, f, cor]) => {
            const a = f === 'lucro' ? ll(d.ytd.atual) : (d.ytd.atual[f] as number)
            const b = f === 'lucro' ? ll(d.ytd.anterior) : (d.ytd.anterior[f] as number)
            return (
              <div key={f}>
                <p className="text-xs text-slate-400">{lab}</p>
                <p className={`text-lg font-bold ${cor}`}>{fmt(a)}</p>
                <p className="text-xs text-slate-400">ant.: {fmt(b)} <Variacao atual={a} base={b} /></p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Transferências entre empresas — referência, não entram em receita/despesa */}
      {d.combinada && d.transferenciasReferencia.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden mb-4">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs font-medium text-slate-500 uppercase tracking-wide">
            Movimentações entre empresas <span className="font-normal">(referência — não contam como receita/despesa)</span>
          </div>
          <div className="divide-y divide-slate-100 max-h-56 overflow-y-auto">
            {d.transferenciasReferencia.map((t, i) => (
              <div key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-slate-600">{fmtData(t.data)} · {t.contaOrigem} → {t.contaDestino}</span>
                <span className="text-slate-500 tabular-nums">
                  {fmtMoeda(t.valorOrigem, t.moedaOrigem)} → {fmtMoeda(t.valorDestino, t.moedaDestino)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Gráfico de evolução */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Evolução</p>
          <select value={visao} onChange={(e) => setVisao(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500">
            {VISOES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <Grafico pontos={d.pontos} />
      </div>
    </div>
  )
}
