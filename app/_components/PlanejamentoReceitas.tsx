'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEmpresas } from './EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type LinhaRec = { id: string; data_prevista: string; valor_previsto: number; valor_pago: number; status: string; descricao: string | null }
type CardCliente = { cliente_id: string; nome: string; linhas: LinhaRec[]; total_previsto: number; total_pago: number }
type Resp = { moeda: Moeda; combinada: boolean; cambioIndisponivel?: boolean; clientes: CardCliente[] }
type Cliente = { id: string; nome: string }

const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }

const STATUS: Record<string, { label: string; cls: string }> = {
  pago: { label: 'Pago', cls: 'bg-green-100 text-green-700' },
  parcial: { label: 'Parcial', cls: 'bg-amber-100 text-amber-700' },
  a_vencer: { label: 'A vencer', cls: 'bg-slate-100 text-slate-600' },
  atrasado: { label: 'Em atraso', cls: 'bg-red-100 text-red-700' },
}

export default function PlanejamentoReceitas() {
  const { empresas, selecionadas, combinada, moedaCombinada } = useEmpresas()
  const [dados, setDados] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | { cliente_id?: string; nome?: string }>(null)
  const [editando, setEditando] = useState<LinhaRec | null>(null)

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (selecionadas.length) p.set('empresas', selecionadas.join(','))
    if (combinada) p.set('moeda', moedaCombinada)
    return p.toString()
  }, [selecionadas, combinada, moedaCombinada])

  const carregar = useCallback(() => {
    setLoading(true)
    fetch(`/api/planejamento/receitas?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setDados(d); setErro(null) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [qs])

  useEffect(() => { carregar() }, [carregar])

  const moeda = dados?.moeda ?? 'BRL'

  const excluir = async (id: string) => {
    if (!confirm('Excluir esta previsão?')) return
    await fetch(`/api/planejamento/receitas?id=${id}`, { method: 'DELETE' })
    carregar()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Base: clientes. Cada card mostra os recebimentos previstos e o realizado (conciliado por mês).</p>
        <button onClick={() => setModal({})} className="bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-700">
          + Nova previsão
        </button>
      </div>

      {dados?.cambioIndisponivel && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          ⚠ Câmbio indisponível para a conversão combinada — valores podem não estar convertidos.
        </div>
      )}
      {erro && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{erro}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm">Carregando…</p>
      ) : !dados?.clientes.length ? (
        <div className="text-center py-16 text-slate-400">
          <p>Nenhuma previsão de receita cadastrada.</p>
          <button onClick={() => setModal({})} className="mt-3 text-slate-700 underline text-sm">Criar a primeira</button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {dados.clientes.map((c) => {
            const atrasadas = c.linhas.filter((l) => l.status === 'atrasado').length
            return (
              <div key={c.cliente_id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                  <div>
                    <p className="font-semibold text-slate-800">{c.nome}</p>
                    <p className="text-xs text-slate-500">
                      Previsto {fmtMoeda(c.total_previsto, moeda)} · Recebido {fmtMoeda(c.total_pago, moeda)}
                      {atrasadas > 0 && <span className="text-red-600 font-medium"> · {atrasadas} em atraso</span>}
                    </p>
                  </div>
                  <button onClick={() => setModal({ cliente_id: c.cliente_id, nome: c.nome })} className="text-slate-500 hover:text-slate-800 text-sm" title="Adicionar lançamento">+ Lançar</button>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {c.linhas.map((l) => (
                      <tr key={l.id} className={`border-b border-slate-50 last:border-0 ${l.status === 'atrasado' ? 'bg-red-50/50' : ''}`}>
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{fmtData(l.data_prevista)}</td>
                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">{fmtMoeda(l.valor_previsto, moeda)}</td>
                        <td className="px-2 py-2 text-right text-slate-500 whitespace-nowrap">{fmtMoeda(l.valor_pago, moeda)}</td>
                        <td className="px-2 py-2">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${STATUS[l.status]?.cls ?? ''}`}>{STATUS[l.status]?.label ?? l.status}</span>
                        </td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setEditando(l)} className="text-slate-400 hover:text-slate-700 mr-2" title="Editar">✎</button>
                          <button onClick={() => excluir(l.id)} className="text-slate-400 hover:text-red-600" title="Excluir">✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}

      {modal && (
        <ModalNova
          empresas={empresas}
          selecionadas={selecionadas}
          clientePreset={modal.cliente_id ? { id: modal.cliente_id, nome: modal.nome ?? '' } : undefined}
          onClose={() => setModal(null)}
          onSalvo={() => { setModal(null); carregar() }}
        />
      )}
      {editando && (
        <ModalEditar linha={editando} moeda={moeda} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function ModalNova({ empresas, selecionadas, clientePreset, onClose, onSalvo }: {
  empresas: { id: string; nome: string; moeda: Moeda }[]
  selecionadas: string[]
  clientePreset?: { id: string; nome: string }
  onClose: () => void
  onSalvo: () => void
}) {
  const [clientes, setClientes] = useState<Cliente[]>([])
  const [empresaId, setEmpresaId] = useState(selecionadas[0] ?? empresas[0]?.id ?? '')
  const [clienteId, setClienteId] = useState(clientePreset?.id ?? '')
  const [data, setData] = useState('')
  const [valor, setValor] = useState('')
  const [repetir, setRepetir] = useState(1)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (clientePreset) return
    fetch('/api/clientes').then((r) => r.json()).then((d) => setClientes(d.pessoas ?? [])).catch(() => {})
  }, [clientePreset])

  const salvar = async () => {
    setErro(null)
    if (!empresaId || !clienteId || !data || !valor) { setErro('Preencha empresa, cliente, data e valor.'); return }
    setBusy(true)
    const r = await fetch('/api/planejamento/receitas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: empresaId, cliente_id: clienteId, data_prevista: data, valor_previsto: Number(valor), repetir: { meses: repetir } }),
    })
    const d = await r.json()
    setBusy(false)
    if (!r.ok) { setErro(d.error ?? 'Erro ao salvar'); return }
    onSalvo()
  }

  return (
    <Overlay onClose={onClose} titulo="Nova previsão de receita">
      {empresas.length > 1 && (
        <Campo label="Empresa">
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.moeda})</option>)}
          </select>
        </Campo>
      )}
      <Campo label="Cliente">
        {clientePreset ? (
          <input value={clientePreset.nome} disabled className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-500" />
        ) : (
          <select value={clienteId} onChange={(e) => setClienteId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Selecione…</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        )}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Data prevista"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
        <Campo label="Valor previsto"><input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
      </div>
      <Campo label="Repetir por N meses (mesmo dia)">
        <input type="number" min={1} max={60} value={repetir} onChange={(e) => setRepetir(Math.max(1, Number(e.target.value)))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </Campo>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <BotoesModal busy={busy} onClose={onClose} onSalvar={salvar} />
    </Overlay>
  )
}

function ModalEditar({ linha, moeda, onClose, onSalvo }: { linha: LinhaRec; moeda: Moeda; onClose: () => void; onSalvo: () => void }) {
  const [data, setData] = useState(linha.data_prevista)
  const [valor, setValor] = useState(String(linha.valor_previsto))
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    setBusy(true)
    await fetch('/api/planejamento/receitas', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: linha.id, data_prevista: data, valor_previsto: Number(valor) }),
    })
    setBusy(false)
    onSalvo()
  }
  return (
    <Overlay onClose={onClose} titulo="Editar previsão">
      <p className="text-xs text-slate-400">Valores em {moeda}. Edite na moeda nativa da empresa.</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Data prevista"><input type="date" value={data} onChange={(e) => setData(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
        <Campo label="Valor previsto"><input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
      </div>
      <BotoesModal busy={busy} onClose={onClose} onSalvar={salvar} />
    </Overlay>
  )
}

// --- Primitivos de modal reutilizados ---
export function Overlay({ titulo, children, onClose }: { titulo: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold text-slate-800">{titulo}</h3>
        {children}
      </div>
    </div>
  )
}
export function Campo({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="block text-xs font-medium text-slate-500 mb-1">{label}</span>{children}</label>
}
export function BotoesModal({ busy, onClose, onSalvar }: { busy: boolean; onClose: () => void; onSalvar: () => void }) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg text-slate-600 hover:bg-slate-100">Cancelar</button>
      <button onClick={onSalvar} disabled={busy} className="text-sm px-4 py-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 disabled:opacity-50">{busy ? 'Salvando…' : 'Salvar'}</button>
    </div>
  )
}
