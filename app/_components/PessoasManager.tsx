'use client'

import { useEffect, useState, useCallback } from 'react'

export type Pessoa = {
  id: string
  nome: string
  cnpj: string | null
  email: string | null
  telefone: string | null
  endereco: string | null
  razao_social: string | null
}

type TransacaoRel = {
  id: string
  data: string
  descricao: string
  valor: number
  tipo: string
  contas: { nome: string } | null
}

const CAMPOS: { key: keyof Pessoa; label: string; obrigatorio?: boolean }[] = [
  { key: 'nome', label: 'Nome', obrigatorio: true },
  { key: 'cnpj', label: 'CNPJ' },
  { key: 'email', label: 'E-mail' },
  { key: 'telefone', label: 'Telefone' },
  { key: 'razao_social', label: 'Razão social' },
  { key: 'endereco', label: 'Endereço' },
]

const vazio: Partial<Pessoa> = { nome: '', cnpj: '', email: '', telefone: '', endereco: '', razao_social: '' }

export default function PessoasManager({
  endpoint,
  singular,
  plural,
}: {
  endpoint: string
  singular: string
  plural: string
}) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')

  // modal de criação/edição
  const [modalAberto, setModalAberto] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Pessoa>>(vazio)

  // detalhe (transações)
  const [selecionado, setSelecionado] = useState<Pessoa | null>(null)
  const [transacoes, setTransacoes] = useState<TransacaoRel[]>([])
  const [carregandoDet, setCarregandoDet] = useState(false)

  const buscar = useCallback((termo: string) => {
    const qs = termo.trim() ? `?q=${encodeURIComponent(termo.trim())}` : ''
    fetch(`${endpoint}${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setPessoas(d.pessoas) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [endpoint])

  // carrega na montagem e a cada mudança da busca (debounce)
  useEffect(() => {
    const t = setTimeout(() => buscar(q), q ? 300 : 0)
    return () => clearTimeout(t)
  }, [q, buscar])

  const abrirNovo = () => { setEditId(null); setForm(vazio); setModalAberto(true) }
  const abrirEdicao = (p: Pessoa) => {
    setEditId(p.id)
    setForm({ ...p })
    setModalAberto(true)
  }

  const salvar = async () => {
    if (!form.nome?.trim()) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch(endpoint, {
        method: editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editId ? { ...form, id: editId } : form),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      if (editId) {
        setPessoas((p) => p.map((x) => (x.id === editId ? d.pessoa : x)))
        if (selecionado?.id === editId) setSelecionado(d.pessoa)
      } else {
        setPessoas((p) => [...p, d.pessoa].sort((a, b) => a.nome.localeCompare(b.nome)))
      }
      setModalAberto(false)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const remover = async (p: Pessoa) => {
    if (!confirm(`Excluir ${singular.toLowerCase()} "${p.nome}"?`)) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch(`${endpoint}?id=${p.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setPessoas((prev) => prev.filter((x) => x.id !== p.id))
      if (selecionado?.id === p.id) setSelecionado(null)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const oposto = singular.toLowerCase() === 'cliente' ? 'fornecedor' : 'cliente'
  const converter = async (p: Pessoa) => {
    if (!confirm(`Converter "${p.nome}" para ${oposto}? As transações vinculadas serão movidas.`)) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/pessoas/converter', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: p.id, de: singular.toLowerCase() }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setPessoas((prev) => prev.filter((x) => x.id !== p.id))
      setSelecionado(null)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const abrirDetalhe = async (p: Pessoa) => {
    setSelecionado(p)
    setCarregandoDet(true)
    try {
      const d = await fetch(`${endpoint}?id=${p.id}`).then((r) => r.json())
      setTransacoes(d.transacoes ?? [])
    } catch { setTransacoes([]) } finally { setCarregandoDet(false) }
  }

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">{plural}</h1>
          <p className="text-slate-500 mt-1">Cadastro e transações de {plural.toLowerCase()}</p>
        </div>
        <button onClick={abrirNovo} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700">
          + Novo {singular.toLowerCase()}
        </button>
      </div>

      {erro && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}

      {selecionado ? (
        /* Detalhe + transações */
        <div>
          <button onClick={() => setSelecionado(null)} className="text-sm text-slate-500 hover:text-slate-700 mb-3">← Voltar para a lista</button>
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-slate-800">{selecionado.nome}</h2>
                <div className="text-sm text-slate-500 mt-1 space-y-0.5">
                  {selecionado.razao_social && <p>{selecionado.razao_social}</p>}
                  {selecionado.cnpj && <p>CNPJ: {selecionado.cnpj}</p>}
                  {selecionado.email && <p>{selecionado.email}</p>}
                  {selecionado.telefone && <p>{selecionado.telefone}</p>}
                  {selecionado.endereco && <p>{selecionado.endereco}</p>}
                </div>
              </div>
              <div className="flex gap-2 items-start">
                <button onClick={() => abrirEdicao(selecionado)} className="text-sm text-slate-500 hover:text-slate-800">✎ Editar</button>
                <button onClick={() => converter(selecionado)} disabled={busy} className="text-sm text-slate-500 hover:text-slate-800 whitespace-nowrap disabled:opacity-50">↔ Tornar {oposto}</button>
                <button onClick={() => remover(selecionado)} className="text-sm text-slate-400 hover:text-red-500">🗑</button>
              </div>
            </div>
          </div>

          <h3 className="text-sm font-semibold text-slate-600 mb-2">Transações relacionadas</h3>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            {carregandoDet ? (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">Carregando…</p>
            ) : transacoes.length === 0 ? (
              <p className="px-4 py-6 text-sm text-slate-400 text-center">Nenhuma transação vinculada a este {singular.toLowerCase()}</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {transacoes.map((t) => (
                  <li key={t.id} className="flex items-center justify-between px-4 py-3 text-sm">
                    <div>
                      <p className="text-slate-700">{t.descricao}</p>
                      <p className="text-xs text-slate-400">{fmtData(t.data)}{t.contas?.nome ? ` · ${t.contas.nome}` : ''}</p>
                    </div>
                    <span className={`font-medium tabular-nums ${t.tipo === 'credito' ? 'text-green-600' : 'text-slate-700'}`}>
                      {t.tipo === 'credito' ? '+' : '−'}{fmt(Math.abs(t.valor))}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        /* Lista + busca */
        <>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={`Buscar ${plural.toLowerCase()} por nome, CNPJ ou e-mail…`}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-slate-500"
          />
          {loading ? (
            <div className="animate-pulse h-48 bg-slate-100 rounded-xl" />
          ) : pessoas.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
              <p className="text-4xl mb-3">👥</p>
              <p className="font-medium">{q ? 'Nenhum resultado' : `Nenhum ${singular.toLowerCase()} cadastrado`}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
              {pessoas.map((p) => (
                <div key={p.id} className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50">
                  <button onClick={() => abrirDetalhe(p)} className="flex-1 text-left">
                    <p className="text-sm font-medium text-slate-700">{p.nome}</p>
                    <p className="text-xs text-slate-400">{[p.cnpj, p.email].filter(Boolean).join(' · ') || '—'}</p>
                  </button>
                  <button onClick={() => abrirEdicao(p)} className="text-slate-400 hover:text-slate-700 text-sm" title="Editar">✎</button>
                  <button onClick={() => remover(p)} className="text-slate-400 hover:text-red-500 text-sm" title="Excluir">🗑</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal criar/editar */}
      {modalAberto && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setModalAberto(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-4">{editId ? `Editar ${singular.toLowerCase()}` : `Novo ${singular.toLowerCase()}`}</h2>
            <div className="space-y-3">
              {CAMPOS.map((c) => (
                <div key={c.key}>
                  <label className="block text-xs font-medium text-slate-500 mb-1">
                    {c.label}{c.obrigatorio && <span className="text-red-500"> *</span>}
                  </label>
                  <input
                    value={(form[c.key] as string) ?? ''}
                    onChange={(e) => setForm((f) => ({ ...f, [c.key]: e.target.value }))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
                  />
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModalAberto(false)} className="text-sm text-slate-500 px-3 py-2 hover:text-slate-700">Cancelar</button>
              <button onClick={salvar} disabled={busy || !form.nome?.trim()} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">
                {editId ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
