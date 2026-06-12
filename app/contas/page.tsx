'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Conta = { id: string; nome: string; banco: string; tipo: 'corrente' | 'cartao'; saldo_inicial?: number }
type PlanoConta = { id: string; codigo: string; nome: string; tipo: string }
type Pessoa = { id: string; nome: string }
type Lancamento = {
  id: string
  data: string
  descricao: string
  valor: number
  tipo: 'credito' | 'debito'
  cliente_id: string | null
  fornecedor_id: string | null
  conta_contabil_id: string | null
  manual: boolean
  saldo_calculado: number
}
type ExtratoResp = {
  conta: Conta
  lancamentos: Lancamento[]
  saldoDocumentoPorData: Record<string, number>
  saldoCalculadoFimDia: Record<string, number>
  alertas: Record<string, { calculado: number; documento: number; diff: number }>
  planoContas: PlanoConta[]
  clientes: Pessoa[]
  fornecedores: Pessoa[]
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }

export default function ContasExtratoPage() {
  const [contas, setContas] = useState<Conta[]>([])
  const [contaId, setContaId] = useState<string>('')
  const [ext, setExt] = useState<ExtratoResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalNovo, setModalNovo] = useState(false)

  // form de lançamento manual
  const [nData, setNData] = useState('')
  const [nDescricao, setNDescricao] = useState('')
  const [nValor, setNValor] = useState('')
  const [nTipo, setNTipo] = useState<'credito' | 'debito'>('debito')

  useEffect(() => {
    fetch('/api/contas').then((r) => r.json()).then((d) => {
      if (d.contas) { setContas(d.contas); if (d.contas[0]) setContaId(d.contas[0].id) }
    })
  }, [])

  const carregar = useCallback((id: string) => {
    if (!id) return
    fetch(`/api/extrato?conta_id=${id}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setExt(d) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (contaId) carregar(contaId) }, [contaId, carregar])

  const planoFolhas = useMemo(
    () => (ext?.planoContas ?? []).filter((p) => p.tipo !== 'grupo'),
    [ext]
  )

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/extrato', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      carregar(contaId) // refaz para recalcular saldos/alertas
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const criarManual = async () => {
    if (!nData || !nDescricao || !nValor) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/extrato', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_id: contaId, data: nData, descricao: nDescricao, valor: nValor, tipo: nTipo }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setModalNovo(false); setNDescricao(''); setNValor('')
      carregar(contaId)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const remover = async (l: Lancamento) => {
    if (!confirm(`Remover o lançamento "${l.descricao}"?`)) return
    setBusy(true)
    try {
      await fetch(`/api/extrato?id=${l.id}`, { method: 'DELETE' })
      carregar(contaId)
    } finally { setBusy(false) }
  }

  // valor encode p/ select de cliente/fornecedor
  const pessoaValue = (l: Lancamento) => l.cliente_id ? `c:${l.cliente_id}` : l.fornecedor_id ? `f:${l.fornecedor_id}` : ''
  const onPessoaChange = (l: Lancamento, v: string) => {
    if (v.startsWith('c:')) patch({ id: l.id, cliente_id: v.slice(2), fornecedor_id: '' })
    else if (v.startsWith('f:')) patch({ id: l.id, fornecedor_id: v.slice(2), cliente_id: '' })
    else patch({ id: l.id, cliente_id: '', fornecedor_id: '' })
  }

  const correntes = contas.filter((c) => c.tipo === 'corrente')
  const cartoes = contas.filter((c) => c.tipo === 'cartao')

  // marca o último lançamento de cada dia para mostrar saldo de fim de dia
  const ultimoDoDia = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of ext?.lancamentos ?? []) m[l.data] = l.id
    return m
  }, [ext])

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contas</h1>
          <p className="text-slate-500 mt-1">Extrato cronológico, saldos e classificação</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
            {contas.length === 0 && <option value="">Nenhuma conta</option>}
            {correntes.length > 0 && <optgroup label="🏦 Contas correntes">{correntes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
            {cartoes.length > 0 && <optgroup label="💳 Cartões">{cartoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
          </select>
          <button onClick={() => { setModalNovo(true); setNData('') }} disabled={!contaId} className="bg-slate-800 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">+ Lançamento</button>
          <Link href="/contas/gerenciar" className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2 border border-slate-200 rounded-lg">⚙ Gerenciar</Link>
        </div>
      </div>

      {erro && <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{erro}</div>}

      {loading || !ext ? (
        <div className="animate-pulse h-64 bg-slate-100 rounded-xl" />
      ) : ext.lancamentos.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">🧾</p>
          <p className="font-medium">Sem lançamentos nesta conta</p>
          <p className="text-sm mt-1">Envie um extrato no Upload ou crie um lançamento manual</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-3 py-3 font-medium">Data</th>
                <th className="px-3 py-3 font-medium">Descrição</th>
                <th className="px-3 py-3 font-medium">Cliente / Fornecedor</th>
                <th className="px-3 py-3 font-medium">Conta contábil</th>
                <th className="px-3 py-3 font-medium text-right">Valor</th>
                <th className="px-3 py-3 font-medium text-right">Saldo</th>
                <th className="px-3 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {ext.lancamentos.map((l) => {
                const fimDoDia = ultimoDoDia[l.data] === l.id
                const alerta = fimDoDia ? ext.alertas[l.data] : undefined
                return (
                  <tr key={l.id} className="align-middle">
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{fmtData(l.data)}</td>
                    <td className="px-3 py-2">
                      <span className="text-slate-700">{l.descricao}</span>
                      {l.manual && <span className="ml-1 text-[10px] text-slate-400">(manual)</span>}
                    </td>
                    <td className="px-3 py-2">
                      <select value={pessoaValue(l)} disabled={busy} onChange={(e) => onPessoaChange(l, e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-xs max-w-[150px]">
                        <option value="">—</option>
                        <optgroup label="Clientes">{ext.clientes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nome}</option>)}</optgroup>
                        <optgroup label="Fornecedores">{ext.fornecedores.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.nome}</option>)}</optgroup>
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <select value={l.conta_contabil_id ?? ''} disabled={busy} onChange={(e) => patch({ id: l.id, conta_contabil_id: e.target.value })} className="border border-slate-200 rounded px-2 py-1 text-xs max-w-[170px]">
                        <option value="">—</option>
                        {planoFolhas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <input
                        type="number" step="0.01" defaultValue={l.valor} disabled={busy}
                        onBlur={(e) => { const v = Number(e.target.value); if (v !== l.valor) patch({ id: l.id, valor: v }) }}
                        className="w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right"
                      />
                      <select value={l.tipo} disabled={busy} onChange={(e) => patch({ id: l.id, tipo: e.target.value })} className="ml-1 border border-slate-200 rounded px-1 py-1 text-xs">
                        <option value="credito">C</option>
                        <option value="debito">D</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">
                      <span className={l.saldo_calculado < 0 ? 'text-red-600' : 'text-slate-700'}>{fmt(l.saldo_calculado)}</span>
                      {fimDoDia && alerta && (
                        <div className="text-[10px] text-red-600 font-medium" title={`Documento: ${fmt(alerta.documento)}`}>
                          ⚠ doc: {fmt(alerta.documento)}
                        </div>
                      )}
                      {fimDoDia && !alerta && ext.saldoDocumentoPorData[l.data] !== undefined && (
                        <div className="text-[10px] text-green-600">✓ confere</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button onClick={() => remover(l)} disabled={busy} className="text-slate-300 hover:text-red-500 text-sm">🗑</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal lançamento manual */}
      {modalNovo && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setModalNovo(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-4">Novo lançamento manual</h2>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Data</label>
                <input type="date" value={nData} onChange={(e) => setNData(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Descrição</label>
                <input value={nDescricao} onChange={(e) => setNDescricao(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
              <div className="flex gap-3">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Valor</label>
                  <input type="number" step="0.01" value={nValor} onChange={(e) => setNValor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
                  <select value={nTipo} onChange={(e) => setNTipo(e.target.value as 'credito' | 'debito')} className="border border-slate-300 rounded-lg px-3 py-2 text-sm">
                    <option value="credito">Crédito</option>
                    <option value="debito">Débito</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setModalNovo(false)} className="text-sm text-slate-500 px-3 py-2">Cancelar</button>
              <button onClick={criarManual} disabled={busy || !nData || !nDescricao || !nValor} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Criar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
