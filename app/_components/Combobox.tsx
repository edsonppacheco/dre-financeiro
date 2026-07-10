'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { buscarFuzzy } from '@/lib/fuzzy'

export type Opcao = { value: string; label: string; grupo?: string; fixa?: boolean }

// Combobox com busca tolerante a erro (lib/fuzzy). Emite o `value` da opção
// escolhida — a rota/parent decide o que fazer (mesmo esquema de value dos
// selects antigos, ex: "c:uuid", "transf:uuid", "__novo_cliente__").
export default function Combobox({
  value, opcoes, onChange, placeholder = 'Selecionar…', className = '', disabled,
}: {
  value: string
  opcoes: Opcao[]
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  disabled?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [busca, setBusca] = useState('')
  const [ativo, setAtivo] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const selecionada = opcoes.find((o) => o.value === value)

  const filtradas = useMemo(() => {
    const naoFixas = opcoes.filter((o) => !o.fixa)
    const fixas = opcoes.filter((o) => o.fixa)
    const encontradas = buscarFuzzy(busca, naoFixas, (o) => o.label)
    return [...encontradas, ...fixas]
  }, [busca, opcoes])

  useEffect(() => {
    if (!aberto) return
    inputRef.current?.focus()
    const fora = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAberto(false) }
    document.addEventListener('mousedown', fora)
    return () => document.removeEventListener('mousedown', fora)
  }, [aberto])

  const escolher = (o: Opcao) => { onChange(o.value); setAberto(false); setBusca('') }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setAtivo((i) => Math.min(i + 1, filtradas.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAtivo((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtradas[ativo]) escolher(filtradas[ativo]) }
    else if (e.key === 'Escape') { setAberto(false); setBusca('') }
  }

  return (
    <div className={`relative ${className}`} ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAberto((a) => !a)}
        className="w-full flex items-center justify-between gap-1 border border-slate-200 rounded px-2 py-1 text-xs bg-white hover:border-slate-300 disabled:opacity-50 text-left"
      >
        <span className={`truncate ${selecionada ? 'text-slate-700' : 'text-slate-400'}`}>{selecionada?.label ?? placeholder}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3 shrink-0 text-slate-400"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {aberto && (
        <div className="absolute z-30 mt-1 w-full min-w-[220px] bg-white border border-slate-200 rounded-lg shadow-lg">
          <div className="p-1.5 border-b border-slate-100">
            <input
              ref={inputRef}
              value={busca}
              onChange={(e) => { setBusca(e.target.value); setAtivo(0) }}
              onKeyDown={onKey}
              placeholder="Buscar…"
              className="w-full border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
          </div>
          <ul className="max-h-64 overflow-y-auto py-1">
            {filtradas.length === 0 && <li className="px-3 py-2 text-xs text-slate-400">Nada encontrado</li>}
            {filtradas.map((o, i) => {
              const mostraGrupo = !o.fixa && o.grupo && filtradas[i - 1]?.grupo !== o.grupo
              return (
                <div key={o.value || `__${i}`}>
                  {mostraGrupo && <li className="px-3 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase text-slate-400">{o.grupo}</li>}
                  <li
                    onMouseEnter={() => setAtivo(i)}
                    onMouseDown={(e) => { e.preventDefault(); escolher(o) }}
                    className={`px-3 py-1.5 text-xs cursor-pointer truncate ${i === ativo ? 'bg-slate-100' : ''} ${o.value === value ? 'font-semibold text-slate-800' : o.fixa ? 'text-violet-600' : 'text-slate-600'}`}
                  >
                    {o.label}
                  </li>
                </div>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
