'use client'

import { useEffect, useMemo, useState } from 'react'

type PlanoConta = {
  id: string
  codigo: string
  nome: string
  tipo: string
  pai_id: string | null
  ordem: number
}

const TIPOS: { value: string; label: string }[] = [
  { value: 'receita', label: 'Receita' },
  { value: 'imposto', label: 'Imposto' },
  { value: 'despesa', label: 'Despesa' },
  { value: 'distribuicao', label: 'Distribuição' },
  { value: 'grupo', label: 'Grupo' },
]

const tipoCor: Record<string, string> = {
  receita: 'bg-green-100 text-green-700',
  imposto: 'bg-amber-100 text-amber-700',
  despesa: 'bg-red-100 text-red-700',
  distribuicao: 'bg-purple-100 text-purple-700',
  grupo: 'bg-slate-200 text-slate-600',
}

export default function ConfiguracoesPage() {
  const [contas, setContas] = useState<PlanoConta[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // formulário de criação
  const [novoNome, setNovoNome] = useState('')
  const [novoTipo, setNovoTipo] = useState('despesa')
  const [novoPai, setNovoPai] = useState('')

  // edição inline
  const [editId, setEditId] = useState<string | null>(null)
  const [editNome, setEditNome] = useState('')
  const [editTipo, setEditTipo] = useState('')

  const carregar = () => {
    fetch('/api/plano-contas')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setContas(d.contas)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  // ordena em árvore: raízes por ordem, com filhos logo abaixo
  const emArvore = useMemo(() => {
    const raizes = contas.filter((c) => !c.pai_id).sort((a, b) => a.ordem - b.ordem)
    const out: { conta: PlanoConta; nivel: number }[] = []
    for (const r of raizes) {
      out.push({ conta: r, nivel: 0 })
      contas
        .filter((c) => c.pai_id === r.id)
        .sort((a, b) => a.ordem - b.ordem)
        .forEach((f) => out.push({ conta: f, nivel: 1 }))
    }
    return out
  }, [contas])

  const possiveisPais = useMemo(
    () => contas.filter((c) => !c.pai_id).sort((a, b) => a.ordem - b.ordem),
    [contas]
  )

  const criar = async () => {
    if (!novoNome.trim()) return
    setBusy(true)
    setErro(null)
    try {
      const res = await fetch('/api/plano-contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: novoNome, tipo: novoTipo, pai_id: novoPai || null }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setContas((prev) => [...prev, d.conta])
      setNovoNome('')
      setNovoPai('')
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao criar')
    } finally {
      setBusy(false)
    }
  }

  const iniciarEdicao = (c: PlanoConta) => {
    setEditId(c.id)
    setEditNome(c.nome)
    setEditTipo(c.tipo)
  }

  const salvarEdicao = async () => {
    if (!editId) return
    setBusy(true)
    setErro(null)
    try {
      const res = await fetch('/api/plano-contas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, nome: editNome, tipo: editTipo }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setContas((prev) => prev.map((c) => (c.id === editId ? d.conta : c)))
      setEditId(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setBusy(false)
    }
  }

  const remover = async (c: PlanoConta) => {
    const temFilhos = contas.some((x) => x.pai_id === c.id)
    const msg = temFilhos
      ? `Excluir "${c.nome}" e todas as suas subcontas?`
      : `Excluir "${c.nome}"?`
    if (!confirm(msg)) return
    setBusy(true)
    setErro(null)
    try {
      const res = await fetch(`/api/plano-contas?id=${c.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setContas((prev) => prev.filter((x) => x.id !== c.id && x.pai_id !== c.id))
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao excluir')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Configurações</h1>
        <p className="text-slate-500 mt-1">Plano de contas contábeis</p>
      </div>

      {erro && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
      )}

      {/* Form de criação */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5">
        <h2 className="font-semibold text-slate-700 text-sm mb-3">Nova conta</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
            <input
              value={novoNome}
              onChange={(e) => setNovoNome(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && criar()}
              placeholder="Ex: Despesas com viagens"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
            <select value={novoTipo} onChange={(e) => setNovoTipo(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
              {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Dentro de</label>
            <select value={novoPai} onChange={(e) => setNovoPai(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
              <option value="">— Conta raiz —</option>
              {possiveisPais.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
            </select>
          </div>
          <button
            onClick={criar}
            disabled={busy || !novoNome.trim()}
            className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50"
          >
            Adicionar
          </button>
        </div>
      </div>

      {/* Árvore */}
      {loading ? (
        <div className="animate-pulse h-64 bg-slate-100 rounded-xl" />
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
          {emArvore.map(({ conta, nivel }) => (
            <div key={conta.id} className={`flex items-center gap-3 px-4 py-3 ${nivel === 1 ? 'pl-10 bg-slate-50/40' : ''}`}>
              <span className="text-xs text-slate-400 tabular-nums w-10">{conta.codigo}</span>
              {editId === conta.id ? (
                <>
                  <input
                    value={editNome}
                    onChange={(e) => setEditNome(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && salvarEdicao()}
                    className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                    autoFocus
                  />
                  <select value={editTipo} onChange={(e) => setEditTipo(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                    {TIPOS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                  <button onClick={salvarEdicao} disabled={busy} className="text-xs text-green-600 font-medium hover:underline disabled:opacity-50">Salvar</button>
                  <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
                </>
              ) : (
                <>
                  <span className={`flex-1 text-sm ${nivel === 0 ? 'font-semibold text-slate-700' : 'text-slate-600'}`}>{conta.nome}</span>
                  <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${tipoCor[conta.tipo] ?? 'bg-slate-100 text-slate-500'}`}>
                    {TIPOS.find((t) => t.value === conta.tipo)?.label ?? conta.tipo}
                  </span>
                  <button onClick={() => iniciarEdicao(conta)} className="text-slate-400 hover:text-slate-700 text-sm" title="Editar">✎</button>
                  <button onClick={() => remover(conta)} className="text-slate-400 hover:text-red-500 text-sm" title="Excluir">🗑</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-slate-400 mt-3">
        Este plano de contas é usado para classificar as transações no extrato. Excluir uma conta com subcontas remove
        também as subcontas; transações já classificadas nela ficam sem conta contábil.
      </p>
    </div>
  )
}
