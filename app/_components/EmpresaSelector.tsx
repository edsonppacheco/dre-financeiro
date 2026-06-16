'use client'

import { useRef, useState } from 'react'
import { useEmpresas } from './EmpresaProvider'
import { MOEDAS } from '@/lib/formato'

// Seletor global de empresa(s): uma única empresa (visão nativa) ou múltiplas
// (visão combinada, com escolha de moeda de conversão). Fica no topo, acima do
// conteúdo de cada página — Painel, Contas e Relatórios leem o contexto.
export default function EmpresaSelector() {
  const { empresas, loading, selecionadas, setSelecionadas, combinada, moedaCombinada, setMoedaCombinada } = useEmpresas()
  const [aberto, setAberto] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  if (loading) return <div className="h-9" />
  if (empresas.length <= 1) return null // nada para selecionar com 1 empresa só

  const toggle = (id: string) => {
    if (selecionadas.includes(id)) {
      if (selecionadas.length === 1) return // mantém ao menos uma selecionada
      setSelecionadas(selecionadas.filter((x) => x !== id))
    } else {
      setSelecionadas([...selecionadas, id])
    }
  }

  const label = combinada
    ? `${selecionadas.length} empresas · Combinada`
    : empresas.find((e) => e.id === selecionadas[0])?.nome ?? 'Selecionar empresa'

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-slate-200 bg-white">
      <div className="relative" ref={ref}>
        <button
          onClick={() => setAberto((a) => !a)}
          className="flex items-center gap-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg px-3 py-1.5 hover:bg-slate-50"
        >
          🏢 {label}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5"><path d="M6 9l6 6 6-6" /></svg>
        </button>
        {aberto && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setAberto(false)} />
            <div className="absolute z-20 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg py-1 min-w-[220px]">
              {empresas.map((e) => (
                <label key={e.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer">
                  <input type="checkbox" checked={selecionadas.includes(e.id)} onChange={() => toggle(e.id)} className="rounded" />
                  <span className="flex-1 text-slate-700">{e.nome}</span>
                  <span className="text-xs text-slate-400">{e.moeda}</span>
                </label>
              ))}
              <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100 mt-1">Selecione 2+ para visão combinada</p>
            </div>
          </>
        )}
      </div>

      {combinada && (
        <div className="flex items-center gap-1.5 text-sm">
          <span className="text-slate-400 text-xs">Converter para:</span>
          {MOEDAS.map((m) => (
            <button
              key={m.value}
              onClick={() => setMoedaCombinada(m.value)}
              className={`px-2 py-1 rounded text-xs font-semibold ${moedaCombinada === m.value ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
            >
              {m.value}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
