'use client'

import { useEffect, useState } from 'react'

type Conta = { nome: string; tipo: string; saldo: number }
type MesData = { label: string; receita: number; despesa: number }
type Dash = {
  ultimaAtualizacao: string | null
  contas: Conta[]
  saldoTotal: number
  dividasLongoPrazo: number
  saldoCartoes: number
  esteMes: MesData
  mesPassado: MesData
  mesAnterior: MesData
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }
const pct = (atual: number, base: number) => base === 0 ? null : ((atual - base) / Math.abs(base)) * 100

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

export default function PainelPage() {
  const [d, setD] = useState<Dash | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dashboard').then((r) => r.json()).then((x) => { if (x.error) throw new Error(x.error); setD(x) }).catch((e) => setErro(e.message))
  }, [])

  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
  if (!d) return <div className="animate-pulse space-y-4"><div className="h-8 w-48 bg-slate-200 rounded" /><div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-28 bg-slate-100 rounded-xl" />)}</div></div>

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Painel</h1>
          <p className="text-slate-500 mt-1">Visão geral das finanças</p>
        </div>
        <p className="text-xs text-slate-400">Última atualização: {d.ultimaAtualizacao ? fmtData(d.ultimaAtualizacao) : '—'}</p>
      </div>

      {/* Saldos e dívidas */}
      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        <Card titulo="Saldo total (contas correntes)">
          <p className={`text-3xl font-bold ${d.saldoTotal < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.saldoTotal)}</p>
        </Card>
        <Card titulo="Dívidas de longo prazo (empréstimos)">
          <p className={`text-3xl font-bold ${d.dividasLongoPrazo < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.dividasLongoPrazo)}</p>
        </Card>
        <Card titulo="Cartões (saldo)">
          <p className={`text-3xl font-bold ${d.saldoCartoes < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.saldoCartoes)}</p>
        </Card>
      </div>

      {/* Saldo por conta */}
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

      {/* Receita / Despesa: mês passado vs anterior + este mês */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Card titulo={`Receita — ${d.mesPassado.label}`}>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-bold text-green-600">{fmt(d.mesPassado.receita)}</p>
            <Variacao atual={d.mesPassado.receita} base={d.mesAnterior.receita} />
          </div>
          <p className="text-xs text-slate-400 mt-1">vs {d.mesAnterior.label}: {fmt(d.mesAnterior.receita)}</p>
        </Card>
        <Card titulo={`Despesas — ${d.mesPassado.label}`}>
          <div className="flex items-end justify-between">
            <p className="text-2xl font-bold text-red-600">{fmt(d.mesPassado.despesa)}</p>
            <Variacao atual={d.mesPassado.despesa} base={d.mesAnterior.despesa} />
          </div>
          <p className="text-xs text-slate-400 mt-1">vs {d.mesAnterior.label}: {fmt(d.mesAnterior.despesa)}</p>
        </Card>
      </div>

      <div className="mt-4 bg-white rounded-xl border border-slate-200 p-5">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-3">Este mês ({d.esteMes.label}) — parcial</p>
        <div className="grid grid-cols-3 gap-4">
          <div><p className="text-xs text-slate-400">Receitas</p><p className="text-xl font-bold text-green-600">{fmt(d.esteMes.receita)}</p></div>
          <div><p className="text-xs text-slate-400">Despesas</p><p className="text-xl font-bold text-red-600">{fmt(d.esteMes.despesa)}</p></div>
          <div><p className="text-xs text-slate-400">Resultado</p><p className={`text-xl font-bold ${d.esteMes.receita - d.esteMes.despesa < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(d.esteMes.receita - d.esteMes.despesa)}</p></div>
        </div>
      </div>

      <p className="text-xs text-slate-400 mt-4">Gráfico de evolução e comparativos anuais chegam na próxima atualização.</p>
    </div>
  )
}
