'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEmpresas } from './EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type Ponto = { mes: string; label: string; receita: number; despesa: number; saldo: number }
type ItemLista = { id: string; nome: string; valor: number; codigo?: string }
type Resp = {
  moeda: Moeda; combinada: boolean; cambioIndisponivel?: boolean; meses: number
  serie: Ponto[]
  totais: { receita: number; despesa: number; saldo: number }
  clientes: ItemLista[]
  contas: ItemLista[]
}

const abreviar = (v: number, moeda: Moeda) => {
  const s = moeda === 'USD' ? 'US$' : 'R$'
  const a = Math.abs(v)
  if (a >= 1e6) return `${s} ${(v / 1e6).toFixed(1)}M`
  if (a >= 1e3) return `${s} ${Math.round(v / 1e3)}k`
  return `${s} ${Math.round(v)}`
}

export default function PlanejamentoDashboard() {
  const { selecionadas, combinada, moedaCombinada } = useEmpresas()
  const [meses, setMeses] = useState(6)
  const [dados, setDados] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const qs = useMemo(() => {
    const p = new URLSearchParams({ meses: String(meses) })
    if (selecionadas.length) p.set('empresas', selecionadas.join(','))
    if (combinada) p.set('moeda', moedaCombinada)
    return p.toString()
  }, [meses, selecionadas, combinada, moedaCombinada])

  const carregar = useCallback(() => {
    setLoading(true)
    fetch(`/api/planejamento/dashboard?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setDados(d); setErro(null) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [qs])

  useEffect(() => { carregar() }, [carregar])

  const moeda = dados?.moeda ?? 'BRL'

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Previsão de receitas × despesas dos próximos meses.</p>
        <div className="flex gap-1">
          {[3, 6, 12].map((n) => (
            <button key={n} onClick={() => setMeses(n)} className={`px-3 py-1.5 rounded-lg text-sm font-medium ${meses === n ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{n} meses</button>
          ))}
        </div>
      </div>

      {dados?.cambioIndisponivel && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          ⚠ Câmbio indisponível para a conversão combinada — valores podem não estar convertidos.
        </div>
      )}
      {erro && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{erro}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm">Carregando…</p>
      ) : !dados ? null : (
        <>
          <div className="grid grid-cols-3 gap-4 mb-6">
            <CardTotal titulo="Receitas previstas" valor={dados.totais.receita} moeda={moeda} cor="text-green-600" />
            <CardTotal titulo="Despesas previstas" valor={dados.totais.despesa} moeda={moeda} cor="text-red-600" />
            <CardTotal titulo="Saldo previsto" valor={dados.totais.saldo} moeda={moeda} cor={dados.totais.saldo >= 0 ? 'text-slate-800' : 'text-red-600'} />
          </div>

          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
            <Grafico serie={dados.serie} moeda={moeda} />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <Lista titulo="Clientes previstos (receitas)" itens={dados.clientes} moeda={moeda} vazio="Nenhuma receita prevista no período." />
            <Lista titulo="Contas previstas (despesas)" itens={dados.contas} moeda={moeda} vazio="Nenhuma despesa prevista no período." mostrarCodigo />
          </div>
        </>
      )}
    </div>
  )
}

function CardTotal({ titulo, valor, moeda, cor }: { titulo: string; valor: number; moeda: Moeda; cor: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">{titulo}</p>
      <p className={`mt-2 text-2xl font-bold ${cor}`}>{fmtMoeda(valor, moeda)}</p>
    </div>
  )
}

function Lista({ titulo, itens, moeda, vazio, mostrarCodigo }: { titulo: string; itens: ItemLista[]; moeda: Moeda; vazio: string; mostrarCodigo?: boolean }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <p className="px-4 py-3 border-b border-slate-100 text-sm font-semibold text-slate-700">{titulo}</p>
      {itens.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-400">{vazio}</p>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {itens.map((i) => (
              <tr key={i.id} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2 text-slate-700">{mostrarCodigo && i.codigo && <span className="text-slate-400 mr-1">{i.codigo}</span>}{i.nome}</td>
                <td className="px-4 py-2 text-right text-slate-600 whitespace-nowrap">{fmtMoeda(i.valor, moeda)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// Gráfico de barras agrupadas (receita/despesa) + linha de saldo, SVG inline.
function Grafico({ serie, moeda }: { serie: Ponto[]; moeda: Moeda }) {
  const W = 720, H = 260, padL = 56, padR = 16, padT = 16, padB = 28
  const innerW = W - padL - padR, innerH = H - padT - padB
  const max = Math.max(1, ...serie.map((p) => Math.max(p.receita, p.despesa)))
  const n = serie.length || 1
  const grupoW = innerW / n
  const barW = Math.min(28, grupoW * 0.32)
  const y = (v: number) => padT + innerH - (v / max) * innerH
  const zeroY = padT + innerH

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[520px]" role="img" aria-label="Previsão de receitas e despesas">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => {
          const gy = padT + innerH - f * innerH
          return (
            <g key={f}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="#e2e8f0" strokeWidth={1} />
              <text x={padL - 6} y={gy + 3} textAnchor="end" fontSize={10} fill="#94a3b8">{abreviar(max * f, moeda)}</text>
            </g>
          )
        })}
        {serie.map((p, i) => {
          const cx = padL + i * grupoW + grupoW / 2
          return (
            <g key={p.mes}>
              <rect x={cx - barW - 2} y={y(p.receita)} width={barW} height={zeroY - y(p.receita)} rx={2} fill="#16a34a" />
              <rect x={cx + 2} y={y(p.despesa)} width={barW} height={zeroY - y(p.despesa)} rx={2} fill="#dc2626" />
              <text x={cx} y={H - 8} textAnchor="middle" fontSize={10} fill="#64748b">{p.label}</text>
            </g>
          )
        })}
      </svg>
      <div className="flex gap-4 justify-center mt-2 text-xs text-slate-500">
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-green-600 inline-block" /> Receita prevista</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-red-600 inline-block" /> Despesa prevista</span>
      </div>
    </div>
  )
}
