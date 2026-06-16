'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { Moeda } from '@/lib/formato'

export type Empresa = { id: string; nome: string; moeda: Moeda; pais: string | null }

type EmpresaCtxValue = {
  empresas: Empresa[]
  loading: boolean
  // ids das empresas selecionadas no seletor global. 1 = visão única; 2+ = combinada.
  selecionadas: string[]
  setSelecionadas: (ids: string[]) => void
  combinada: boolean
  moedaCombinada: Moeda
  setMoedaCombinada: (m: Moeda) => void
  // quando há exatamente 1 empresa selecionada, ela é exposta aqui
  empresaUnica: Empresa | null
  recarregar: () => void
}

const Ctx = createContext<EmpresaCtxValue | null>(null)

const LS_SEL = 'empresas_selecionadas'
const LS_MOEDA = 'moeda_combinada'

export function EmpresaProvider({ children }: { children: React.ReactNode }) {
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [loading, setLoading] = useState(true)
  const [selecionadas, setSelecionadasState] = useState<string[]>([])
  const [moedaCombinada, setMoedaCombinadaState] = useState<Moeda>('USD')

  const carregar = useCallback(() => {
    setLoading(true)
    fetch('/api/empresas')
      .then((r) => r.json())
      .then((d) => {
        const lista: Empresa[] = d.empresas ?? []
        setEmpresas(lista)
        let salvas: string[] = []
        try { salvas = JSON.parse(localStorage.getItem(LS_SEL) ?? '[]') } catch { /* ignora */ }
        const validas = salvas.filter((id) => lista.some((e) => e.id === id))
        setSelecionadasState(validas.length ? validas : lista.length ? [lista[0].id] : [])
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const m = localStorage.getItem(LS_MOEDA)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (m === 'BRL' || m === 'USD') setMoedaCombinadaState(m)
    carregar()
  }, [carregar])

  const setSelecionadas = (ids: string[]) => {
    setSelecionadasState(ids)
    localStorage.setItem(LS_SEL, JSON.stringify(ids))
  }
  const setMoedaCombinada = (m: Moeda) => {
    setMoedaCombinadaState(m)
    localStorage.setItem(LS_MOEDA, m)
  }

  const combinada = selecionadas.length > 1
  const empresaUnica = selecionadas.length === 1 ? empresas.find((e) => e.id === selecionadas[0]) ?? null : null

  return (
    <Ctx.Provider value={{ empresas, loading, selecionadas, setSelecionadas, combinada, moedaCombinada, setMoedaCombinada, empresaUnica, recarregar: carregar }}>
      {children}
    </Ctx.Provider>
  )
}

export function useEmpresas() {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useEmpresas precisa estar dentro de <EmpresaProvider>')
  return ctx
}
