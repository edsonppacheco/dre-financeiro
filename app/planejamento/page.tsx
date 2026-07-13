'use client'

import { useState } from 'react'
import PlanejamentoReceitas from '../_components/PlanejamentoReceitas'
import PlanejamentoDespesas from '../_components/PlanejamentoDespesas'
import PlanejamentoDashboard from '../_components/PlanejamentoDashboard'

type Aba = 'previsao' | 'receitas' | 'despesas'

const ABAS: { id: Aba; label: string }[] = [
  { id: 'previsao', label: 'Previsão' },
  { id: 'receitas', label: 'Receitas' },
  { id: 'despesas', label: 'Despesas' },
]

export default function PlanejamentoPage() {
  const [aba, setAba] = useState<Aba>('previsao')

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Planejamento</h1>
        <p className="text-sm text-slate-500 mt-1">Previsões de receitas e despesas e acompanhamento do realizado.</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {ABAS.map((a) => (
          <button
            key={a.id}
            onClick={() => setAba(a.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              aba === a.id ? 'border-slate-800 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {a.label}
          </button>
        ))}
      </div>

      {aba === 'previsao' && <PlanejamentoDashboard />}
      {aba === 'receitas' && <PlanejamentoReceitas />}
      {aba === 'despesas' && <PlanejamentoDespesas />}
    </div>
  )
}
