'use client'

import { useEffect, useMemo, useState } from 'react'
import { useEmpresas } from '../_components/EmpresaProvider'
import { MOEDAS } from '@/lib/formato'

type PlanoConta = {
  id: string
  codigo: string
  nome: string
  tipo: string
  pai_id: string | null
  ordem: number
}

// "Distribuição" não é mais um tipo criável no plano de contas (vira item de série no relatório)
const TIPOS: { value: string; label: string }[] = [
  { value: 'receita', label: 'Receita' },
  { value: 'imposto', label: 'Imposto' },
  { value: 'despesa', label: 'Despesa' },
  { value: 'grupo', label: 'Grupo' },
]

const tipoCor: Record<string, string> = {
  receita: 'bg-green-100 text-green-700',
  imposto: 'bg-amber-100 text-amber-700',
  despesa: 'bg-red-100 text-red-700',
  distribuicao: 'bg-purple-100 text-purple-700',
  grupo: 'bg-slate-200 text-slate-600',
}

// Gestão de empresas (multi-empresa: cada uma com sua moeda).
function EmpresasManager() {
  const { empresas, recarregar } = useEmpresas()
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [nNome, setNNome] = useState('')
  const [nMoeda, setNMoeda] = useState<'BRL' | 'USD'>('BRL')
  const [nPais, setNPais] = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  const [eNome, setENome] = useState('')
  const [eMoeda, setEMoeda] = useState<'BRL' | 'USD'>('BRL')

  const criar = async () => {
    if (!nNome.trim()) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/empresas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: nNome, moeda: nMoeda, pais: nPais }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setNNome(''); setNPais(''); recarregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao criar') } finally { setBusy(false) }
  }

  const salvar = async () => {
    if (!editId) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/empresas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editId, nome: eNome, moeda: eMoeda }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setEditId(null); recarregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao salvar') } finally { setBusy(false) }
  }

  const remover = async (id: string, nome: string) => {
    if (!confirm(`Excluir a empresa "${nome}"?`)) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch(`/api/empresas?id=${id}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      recarregar()
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao excluir') } finally { setBusy(false) }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <h2 className="font-semibold text-slate-700 text-sm mb-1">Empresas</h2>
      <p className="text-xs text-slate-400 mb-3">Cada empresa tem sua própria moeda. Contas bancárias pertencem a uma empresa.</p>

      {erro && <div className="mb-3 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg px-3 py-2">{erro}</div>}

      <div className="divide-y divide-slate-100 mb-3">
        {empresas.map((e) => (
          <div key={e.id} className="flex items-center gap-3 py-2.5">
            {editId === e.id ? (
              <>
                <input value={eNome} onChange={(ev) => setENome(ev.target.value)} className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm" autoFocus />
                <select value={eMoeda} onChange={(ev) => setEMoeda(ev.target.value as 'BRL' | 'USD')} className="border border-slate-300 rounded-lg px-2 py-1 text-xs">
                  {MOEDAS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
                <button onClick={salvar} disabled={busy} className="text-xs text-green-600 font-medium hover:underline disabled:opacity-50">Salvar</button>
                <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
              </>
            ) : (
              <>
                <span className="flex-1 text-sm font-medium text-slate-700">{e.nome}</span>
                <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{e.moeda}</span>
                <button onClick={() => { setEditId(e.id); setENome(e.nome); setEMoeda(e.moeda) }} className="text-slate-400 hover:text-slate-700 text-sm" title="Editar">✎</button>
                <button onClick={() => remover(e.id, e.nome)} className="text-slate-400 hover:text-red-500 text-sm" title="Excluir">🗑</button>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 pt-2 border-t border-slate-100">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
          <input value={nNome} onChange={(e) => setNNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criar()} placeholder="Ex: VenturiX US" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1">Moeda</label>
          <select value={nMoeda} onChange={(e) => setNMoeda(e.target.value as 'BRL' | 'USD')} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {MOEDAS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
        </div>
        <div className="min-w-[100px]">
          <label className="block text-xs font-medium text-slate-500 mb-1">País</label>
          <input value={nPais} onChange={(e) => setNPais(e.target.value)} placeholder="US" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
        </div>
        <button onClick={criar} disabled={busy || !nNome.trim()} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Adicionar</button>
      </div>
    </div>
  )
}

type CambioRow = { mes: string; taxa: number; fonte: string | null }

// Câmbio médio mensal (USD->BRL), usado para converter a visão combinada entre
// empresas de moedas diferentes. Só é relevante havendo mais de uma moeda em uso.
function CambioManager() {
  const [cambios, setCambios] = useState<CambioRow[]>([])
  const [loading, setLoading] = useState(true)
  const [atualizando, setAtualizando] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [editMes, setEditMes] = useState<string | null>(null)
  const [editTaxa, setEditTaxa] = useState('')

  const carregar = () => {
    fetch('/api/cambio').then((r) => r.json()).then((d) => { if (!d.error) setCambios(d.cambios) }).finally(() => setLoading(false))
  }
  useEffect(() => { carregar() }, [])

  const atualizar = async () => {
    setAtualizando(true); setMsg(null)
    try {
      const res = await fetch('/api/cambio', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setMsg(`${d.atualizados.length} mês(es) atualizado(s)${d.comErro.length ? `, ${d.comErro.length} com erro` : ''}.`)
      carregar()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao atualizar câmbio') } finally { setAtualizando(false) }
  }

  const salvarManual = async () => {
    if (!editMes) return
    const taxa = Number(editTaxa.replace(',', '.'))
    if (!taxa || taxa <= 0) return
    try {
      const res = await fetch('/api/cambio', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mes: editMes, taxa }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setEditMes(null); carregar()
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Erro ao salvar') }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-semibold text-slate-700 text-sm">Câmbio mensal (USD → BRL)</h2>
        <button onClick={atualizar} disabled={atualizando} className="text-xs bg-slate-800 text-white font-semibold px-3 py-1.5 rounded-lg hover:bg-slate-700 disabled:opacity-50">
          {atualizando ? 'Atualizando…' : 'Atualizar câmbio'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Média mensal das cotações diárias (AwesomeAPI), usada para converter a visão combinada entre empresas de moedas diferentes.
      </p>
      {msg && <div className="mb-3 bg-slate-50 border border-slate-200 text-slate-600 text-xs rounded-lg px-3 py-2">{msg}</div>}

      {loading ? (
        <div className="animate-pulse h-24 bg-slate-100 rounded-lg" />
      ) : cambios.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-4">Nenhum câmbio registrado ainda. Clique em &quot;Atualizar câmbio&quot;.</p>
      ) : (
        <div className="max-h-64 overflow-y-auto divide-y divide-slate-100">
          {cambios.map((c) => (
            <div key={c.mes} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-20 text-slate-600 font-medium">{c.mes}</span>
              {editMes === c.mes ? (
                <>
                  <input value={editTaxa} onChange={(e) => setEditTaxa(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && salvarManual()} className="w-24 border border-slate-300 rounded px-2 py-1 text-xs" autoFocus />
                  <button onClick={salvarManual} className="text-xs text-green-600 font-medium hover:underline">Salvar</button>
                  <button onClick={() => setEditMes(null)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
                </>
              ) : (
                <>
                  <span className="flex-1 tabular-nums text-slate-700">{c.taxa.toFixed(4)}</span>
                  <span className="text-[11px] text-slate-400">{c.fonte ?? '—'}</span>
                  <button onClick={() => { setEditMes(c.mes); setEditTaxa(String(c.taxa)) }} className="text-slate-400 hover:text-slate-700 text-xs" title="Editar">✎</button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function ConfiguracoesPage() {
  const { empresas } = useEmpresas()
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
  const [editPai, setEditPai] = useState('')

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
    setEditPai(c.pai_id ?? '')
  }

  const salvarEdicao = async () => {
    if (!editId) return
    setBusy(true)
    setErro(null)
    try {
      const res = await fetch('/api/plano-contas', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, nome: editNome, tipo: editTipo, pai_id: editPai || null }),
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

  // Reposiciona uma conta trocando a ordem com a irmã vizinha (mesmo pai)
  const mover = async (c: PlanoConta, dir: -1 | 1) => {
    const irmaos = contas.filter((x) => (x.pai_id ?? null) === (c.pai_id ?? null)).sort((a, b) => a.ordem - b.ordem)
    const i = irmaos.findIndex((x) => x.id === c.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= irmaos.length) return
    const a = irmaos[i], b = irmaos[j]
    setBusy(true); setErro(null)
    try {
      await Promise.all([
        fetch('/api/plano-contas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, ordem: b.ordem }) }),
        fetch('/api/plano-contas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: b.id, ordem: a.ordem }) }),
      ])
      setContas((prev) => prev.map((x) => x.id === a.id ? { ...x, ordem: b.ordem } : x.id === b.id ? { ...x, ordem: a.ordem } : x))
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro ao reposicionar') } finally { setBusy(false) }
  }

  // primeiro/último entre os irmãos (para desabilitar ↑/↓)
  const irmaosDe = (c: PlanoConta) => contas.filter((x) => (x.pai_id ?? null) === (c.pai_id ?? null)).sort((a, b) => a.ordem - b.ordem)
  const grupos = contas.filter((c) => c.tipo === 'grupo')

  return (
    <div className="max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Configurações</h1>
        <p className="text-slate-500 mt-1">Plano de contas contábeis</p>
      </div>

      {erro && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>
      )}

      <EmpresasManager />
      {new Set(empresas.map((e) => e.moeda)).size > 1 && <CambioManager />}

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
                  <select value={editPai} onChange={(e) => setEditPai(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1 text-xs" title="Grupo">
                    <option value="">— Raiz —</option>
                    {grupos.filter((g) => g.id !== editId).map((g) => <option key={g.id} value={g.id}>{g.nome}</option>)}
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
                  <button onClick={() => mover(conta, -1)} disabled={busy || irmaosDe(conta)[0]?.id === conta.id} className="text-slate-400 hover:text-slate-700 text-sm disabled:opacity-30" title="Mover para cima">↑</button>
                  <button onClick={() => mover(conta, 1)} disabled={busy || irmaosDe(conta).slice(-1)[0]?.id === conta.id} className="text-slate-400 hover:text-slate-700 text-sm disabled:opacity-30" title="Mover para baixo">↓</button>
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
