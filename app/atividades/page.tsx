'use client'

import { useEffect, useMemo, useState } from 'react'

type Atividade = {
  id: string
  created_at: string
  acao: string
  entidade: string | null
  entidade_id: string | null
  descricao: string
  dados: Record<string, unknown> | null
}

const ICONE: Record<string, string> = {
  upload: '📥', criar_lancamento: '➕', editar_lancamento: '✏️', remover_lancamento: '🗑️',
  transferencia: '⇄', desfazer_transferencia: '↩️', cambio: '💱',
  criar_conta: '🏦', criar_empresa: '🏢', criar_pessoa: '👤',
}
const ROTULO: Record<string, string> = {
  upload: 'Upload', criar_lancamento: 'Lançamento', editar_lancamento: 'Edição', remover_lancamento: 'Remoção',
  transferencia: 'Transferência', desfazer_transferencia: 'Transferência', cambio: 'Câmbio',
  criar_conta: 'Conta', criar_empresa: 'Empresa', criar_pessoa: 'Cadastro',
}

const fmtQuando = (iso: string) => {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}
const diaDe = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })

export default function AtividadesPage() {
  const [ativs, setAtivs] = useState<Atividade[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [pendente, setPendente] = useState(false)
  const [filtro, setFiltro] = useState('')

  useEffect(() => {
    fetch('/api/atividades?limite=300')
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setAtivs(d.atividades); setPendente(!!d.pendente) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

  const acoes = useMemo(() => Array.from(new Set(ativs.map((a) => a.acao))), [ativs])
  const filtradas = useMemo(() => filtro ? ativs.filter((a) => a.acao === filtro) : ativs, [ativs, filtro])

  // agrupa por dia
  const porDia = useMemo(() => {
    const map = new Map<string, Atividade[]>()
    for (const a of filtradas) { const d = a.created_at.slice(0, 10); if (!map.has(d)) map.set(d, []); map.get(d)!.push(a) }
    return Array.from(map.entries())
  }, [filtradas])

  if (erro) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
  if (loading) return <div className="animate-pulse space-y-3"><div className="h-8 w-64 bg-slate-200 rounded" /><div className="h-96 bg-slate-100 rounded-xl" /></div>

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-5 flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Atividades</h1>
          <p className="text-slate-500 mt-1">Histórico das ações no sistema</p>
        </div>
        <div className="relative">
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} className="appearance-none border border-slate-300 rounded-lg pl-3 pr-8 py-1.5 text-sm bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500">
            <option value="">Todas as ações</option>
            {acoes.map((a) => <option key={a} value={a}>{ROTULO[a] ?? a}</option>)}
          </select>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><path d="M6 9l6 6 6-6" /></svg>
        </div>
      </div>

      {pendente ? (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-xl px-4 py-4">
          <p className="font-medium mb-1">Log de atividades ainda não ativado</p>
          <p>A tabela <code className="bg-amber-100 px-1 rounded">atividades</code> precisa ser criada no banco (migration 011). Depois disso, as ações passam a ser registradas aqui automaticamente.</p>
        </div>
      ) : filtradas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">🕓</p>
          <p className="font-medium">Nenhuma atividade registrada</p>
        </div>
      ) : (
        <div className="space-y-6">
          {porDia.map(([dia, itens]) => (
            <div key={dia}>
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2 capitalize">{diaDe(dia + 'T00:00:00')}</h2>
              <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
                {itens.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="text-lg leading-none mt-0.5">{ICONE[a.acao] ?? '•'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-slate-700">{a.descricao}</p>
                      <p className="text-xs text-slate-400">{ROTULO[a.acao] ?? a.acao} · {fmtQuando(a.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
