'use client'

import { useEffect, useMemo, useState } from 'react'

type Conta = { id: string; nome: string; banco: string; tipo: 'corrente' | 'cartao' }
type Transferencia = {
  id: string
  data: string
  valor: number
  descricao: string | null
  conta_origem_id: string
  conta_destino_id: string
}

export default function ContasPage() {
  const [contas, setContas] = useState<Conta[]>([])
  const [transfs, setTransfs] = useState<Transferencia[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // nova conta
  const [nNome, setNNome] = useState('')
  const [nBanco, setNBanco] = useState('')
  const [nTipo, setNTipo] = useState<'corrente' | 'cartao'>('corrente')

  // edição inline
  const [editId, setEditId] = useState<string | null>(null)
  const [eNome, setENome] = useState('')
  const [eBanco, setEBanco] = useState('')

  // pagamento de cartão (transferência)
  const [tOrigem, setTOrigem] = useState('')
  const [tDestino, setTDestino] = useState('')
  const [tData, setTData] = useState('')
  const [tValor, setTValor] = useState('')

  const carregar = () => {
    Promise.all([
      fetch('/api/contas').then((r) => r.json()),
      fetch('/api/transferencias').then((r) => r.json()),
    ])
      .then(([c, t]) => {
        if (c.error) throw new Error(c.error)
        setContas(c.contas)
        setTransfs(t.transferencias ?? [])
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    carregar()
  }, [])

  const correntes = useMemo(() => contas.filter((c) => c.tipo === 'corrente'), [contas])
  const cartoes = useMemo(() => contas.filter((c) => c.tipo === 'cartao'), [contas])
  const nomeConta = (id: string) => contas.find((c) => c.id === id)?.nome ?? '—'

  const criar = async () => {
    if (!nNome.trim() || !nBanco.trim()) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/contas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: nNome, banco: nBanco, tipo: nTipo }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      if (d.conta) setContas((p) => [...p, d.conta])
      else carregar() // conta já existia (upsert)
      setNNome(''); setNBanco('')
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const salvarEdicao = async () => {
    if (!editId) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/contas', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: editId, nome: eNome, banco: eBanco }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setContas((p) => p.map((c) => (c.id === editId ? d.conta : c)))
      setEditId(null)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const remover = async (c: Conta) => {
    if (!confirm(`Excluir a conta "${c.nome}"?`)) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch(`/api/contas?id=${c.id}`, { method: 'DELETE' })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setContas((p) => p.filter((x) => x.id !== c.id))
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const registrarPagamento = async () => {
    if (!tOrigem || !tDestino || !tData || !tValor) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/transferencias', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_origem_id: tOrigem, conta_destino_id: tDestino, data: tData, valor: tValor }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setTransfs((p) => [d.transferencia, ...p])
      setTValor('')
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
  const fmtData = (d: string) => { const [a, m, dia] = d.split('-'); return `${dia}/${m}/${a}` }

  const Linha = ({ c }: { c: Conta }) => (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
      {editId === c.id ? (
        <>
          <input value={eNome} onChange={(e) => setENome(e.target.value)} className="flex-1 border border-slate-300 rounded-lg px-2 py-1 text-sm" autoFocus />
          <input value={eBanco} onChange={(e) => setEBanco(e.target.value)} className="w-32 border border-slate-300 rounded-lg px-2 py-1 text-sm" />
          <button onClick={salvarEdicao} disabled={busy} className="text-xs text-green-600 font-medium hover:underline disabled:opacity-50">Salvar</button>
          <button onClick={() => setEditId(null)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
        </>
      ) : (
        <>
          <div className="flex-1">
            <p className="text-sm font-medium text-slate-700">{c.nome}</p>
            <p className="text-xs text-slate-400">{c.banco}</p>
          </div>
          <button onClick={() => { setEditId(c.id); setENome(c.nome); setEBanco(c.banco) }} className="text-slate-400 hover:text-slate-700 text-sm" title="Editar">✎</button>
          <button onClick={() => remover(c)} className="text-slate-400 hover:text-red-500 text-sm" title="Excluir">🗑</button>
        </>
      )}
    </div>
  )

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <a href="/contas" className="text-sm text-slate-500 hover:text-slate-700">← Voltar ao extrato</a>
        <h1 className="text-2xl font-bold text-slate-800 mt-1">Gerenciar contas</h1>
        <p className="text-slate-500 mt-1">Contas correntes, cartões de crédito e pagamentos</p>
      </div>

      {erro && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}

      {/* Nova conta */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6">
        <h2 className="font-semibold text-slate-700 text-sm mb-3">Nova conta</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[160px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome</label>
            <input value={nNome} onChange={(e) => setNNome(e.target.value)} placeholder="Ex: Conta PJ Itaú" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
          </div>
          <div className="min-w-[120px]">
            <label className="block text-xs font-medium text-slate-500 mb-1">Banco</label>
            <input value={nBanco} onChange={(e) => setNBanco(e.target.value)} placeholder="Ex: Itaú" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
            <select value={nTipo} onChange={(e) => setNTipo(e.target.value as 'corrente' | 'cartao')} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
              <option value="corrente">Conta corrente</option>
              <option value="cartao">Cartão de crédito</option>
            </select>
          </div>
          <button onClick={criar} disabled={busy || !nNome.trim() || !nBanco.trim()} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Adicionar</button>
        </div>
      </div>

      {loading ? (
        <div className="animate-pulse h-48 bg-slate-100 rounded-xl" />
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Contas correntes */}
          <div>
            <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">🏦 Contas correntes <span className="text-xs text-slate-400">({correntes.length})</span></h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {correntes.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400 text-center">Nenhuma conta corrente</p> : correntes.map((c) => <Linha key={c.id} c={c} />)}
            </div>
          </div>
          {/* Cartões */}
          <div>
            <h2 className="text-sm font-semibold text-slate-600 mb-2 flex items-center gap-2">💳 Cartões de crédito <span className="text-xs text-slate-400">({cartoes.length})</span></h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              {cartoes.length === 0 ? <p className="px-4 py-6 text-sm text-slate-400 text-center">Nenhum cartão</p> : cartoes.map((c) => <Linha key={c.id} c={c} />)}
            </div>
          </div>
        </div>
      )}

      {/* Pagamento de cartão (transferência) */}
      <div className="mt-8">
        <h2 className="font-semibold text-slate-700 text-sm mb-2">Pagamento de cartão</h2>
        <p className="text-xs text-slate-400 mb-3">Registra uma transferência de uma conta corrente para um cartão de crédito.</p>
        <div className="bg-white rounded-xl border border-slate-200 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[150px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">De (conta)</label>
              <select value={tOrigem} onChange={(e) => setTOrigem(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {correntes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-xs font-medium text-slate-500 mb-1">Para (cartão)</label>
              <select value={tDestino} onChange={(e) => setTDestino(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                <option value="">Selecione…</option>
                {cartoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Data</label>
              <input type="date" value={tData} onChange={(e) => setTData(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Valor</label>
              <input type="number" step="0.01" value={tValor} onChange={(e) => setTValor(e.target.value)} placeholder="0,00" className="w-28 border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            </div>
            <button onClick={registrarPagamento} disabled={busy || !tOrigem || !tDestino || !tData || !tValor} className="bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-green-700 disabled:opacity-50">Registrar</button>
          </div>

          {transfs.length > 0 && (
            <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
              {transfs.map((t) => (
                <li key={t.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-slate-600">{fmtData(t.data)} · {nomeConta(t.conta_origem_id)} → {nomeConta(t.conta_destino_id)}</span>
                  <span className="font-medium text-slate-700 tabular-nums">{fmt(t.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}
