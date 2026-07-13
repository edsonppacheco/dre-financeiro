'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEmpresas } from './EmpresaProvider'
import { fmtMoeda, type Moeda } from '@/lib/formato'
import { Overlay, Campo, BotoesModal } from './PlanejamentoReceitas'

type LinhaDesp = { ids: string[]; mes: string; valor_previsto: number; valor_pago: number }
type CardConta = { conta_contabil_id: string; codigo: string; nome: string; linhas: LinhaDesp[]; total_previsto: number; total_pago: number }
type Resp = { moeda: Moeda; combinada: boolean; cambioIndisponivel?: boolean; contas: CardConta[] }
type PlanoConta = { id: string; codigo: string; nome: string; tipo: string }

const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${NOMES[Number(mm) - 1]}/${a}` }

export default function PlanejamentoDespesas() {
  const { empresas, selecionadas, combinada, moedaCombinada } = useEmpresas()
  const [dados, setDados] = useState<Resp | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState<null | { conta_contabil_id?: string; nome?: string }>(null)
  const [editando, setEditando] = useState<{ conta: string; linha: LinhaDesp } | null>(null)

  const qs = useMemo(() => {
    const p = new URLSearchParams()
    if (selecionadas.length) p.set('empresas', selecionadas.join(','))
    if (combinada) p.set('moeda', moedaCombinada)
    return p.toString()
  }, [selecionadas, combinada, moedaCombinada])

  const carregar = useCallback(() => {
    setLoading(true)
    fetch(`/api/planejamento/despesas?${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setDados(d); setErro(null) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [qs])

  useEffect(() => { carregar() }, [carregar])

  const moeda = dados?.moeda ?? 'BRL'

  const excluir = async (ids: string[]) => {
    if (!confirm('Excluir esta previsão?')) return
    await fetch(`/api/planejamento/despesas?ids=${ids.join(',')}`, { method: 'DELETE' })
    carregar()
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">Base: contas contábeis (plano de contas). Cada mês mostra o previsto e o realizado somado.</p>
        <button onClick={() => setModal({})} className="bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-slate-700">+ Nova previsão</button>
      </div>

      {dados?.cambioIndisponivel && (
        <div className="mb-4 text-sm bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-3 py-2">
          ⚠ Câmbio indisponível para a conversão combinada — valores podem não estar convertidos.
        </div>
      )}
      {erro && <div className="mb-4 text-sm bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 py-2">{erro}</div>}

      {loading ? (
        <p className="text-slate-400 text-sm">Carregando…</p>
      ) : !dados?.contas.length ? (
        <div className="text-center py-16 text-slate-400">
          <p>Nenhuma previsão de despesa cadastrada.</p>
          <button onClick={() => setModal({})} className="mt-3 text-slate-700 underline text-sm">Criar a primeira</button>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {dados.contas.map((c) => (
            <div key={c.conta_contabil_id} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                <div>
                  <p className="font-semibold text-slate-800"><span className="text-slate-400 mr-1">{c.codigo}</span>{c.nome}</p>
                  <p className="text-xs text-slate-500">Previsto {fmtMoeda(c.total_previsto, moeda)} · Realizado {fmtMoeda(c.total_pago, moeda)}</p>
                </div>
                <button onClick={() => setModal({ conta_contabil_id: c.conta_contabil_id, nome: `${c.codigo} ${c.nome}` })} className="text-slate-500 hover:text-slate-800 text-sm" title="Adicionar mês">+ Lançar</button>
              </div>
              <table className="w-full text-sm">
                <tbody>
                  {c.linhas.map((l) => {
                    const estouro = l.valor_pago > l.valor_previsto && l.valor_previsto > 0
                    return (
                      <tr key={l.mes} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-2 text-slate-600 whitespace-nowrap">{rotuloMes(l.mes)}</td>
                        <td className="px-2 py-2 text-right text-slate-700 whitespace-nowrap">{fmtMoeda(l.valor_previsto, moeda)}</td>
                        <td className={`px-2 py-2 text-right whitespace-nowrap ${estouro ? 'text-red-600 font-medium' : 'text-slate-500'}`}>{fmtMoeda(l.valor_pago, moeda)}</td>
                        <td className="px-2 py-2 text-right whitespace-nowrap">
                          <button onClick={() => setEditando({ conta: c.conta_contabil_id, linha: l })} className="text-slate-400 hover:text-slate-700 mr-2" title="Editar">✎</button>
                          <button onClick={() => excluir(l.ids)} className="text-slate-400 hover:text-red-600" title="Excluir">✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <ModalNova
          empresas={empresas}
          selecionadas={selecionadas}
          contaPreset={modal.conta_contabil_id ? { id: modal.conta_contabil_id, nome: modal.nome ?? '' } : undefined}
          onClose={() => setModal(null)}
          onSalvo={() => { setModal(null); carregar() }}
        />
      )}
      {editando && (
        <ModalEditar linha={editando.linha} moeda={moeda} onClose={() => setEditando(null)} onSalvo={() => { setEditando(null); carregar() }} />
      )}
    </div>
  )
}

function ModalNova({ empresas, selecionadas, contaPreset, onClose, onSalvo }: {
  empresas: { id: string; nome: string; moeda: Moeda }[]
  selecionadas: string[]
  contaPreset?: { id: string; nome: string }
  onClose: () => void
  onSalvo: () => void
}) {
  const [contas, setContas] = useState<PlanoConta[]>([])
  const [empresaId, setEmpresaId] = useState(selecionadas[0] ?? empresas[0]?.id ?? '')
  const [contaId, setContaId] = useState(contaPreset?.id ?? '')
  const [mes, setMes] = useState('')
  const [valor, setValor] = useState('')
  const [repetir, setRepetir] = useState(1)
  const [busy, setBusy] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (contaPreset) return
    fetch('/api/plano-contas').then((r) => r.json())
      .then((d) => setContas((d.contas ?? []).filter((c: PlanoConta) => c.tipo === 'despesa' || c.tipo === 'imposto')))
      .catch(() => {})
  }, [contaPreset])

  const salvar = async () => {
    setErro(null)
    if (!empresaId || !contaId || !mes || !valor) { setErro('Preencha empresa, conta, mês e valor.'); return }
    setBusy(true)
    const r = await fetch('/api/planejamento/despesas', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ empresa_id: empresaId, conta_contabil_id: contaId, mes, valor_previsto: Number(valor), repetir: { meses: repetir } }),
    })
    const d = await r.json()
    setBusy(false)
    if (!r.ok) { setErro(d.error ?? 'Erro ao salvar'); return }
    onSalvo()
  }

  return (
    <Overlay onClose={onClose} titulo="Nova previsão de despesa">
      {empresas.length > 1 && (
        <Campo label="Empresa">
          <select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nome} ({e.moeda})</option>)}
          </select>
        </Campo>
      )}
      <Campo label="Conta contábil">
        {contaPreset ? (
          <input value={contaPreset.nome} disabled className="w-full border border-slate-200 bg-slate-50 rounded-lg px-3 py-2 text-sm text-slate-500" />
        ) : (
          <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
            <option value="">Selecione…</option>
            {contas.map((c) => <option key={c.id} value={c.id}>{c.codigo} — {c.nome}</option>)}
          </select>
        )}
      </Campo>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="Mês"><input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
        <Campo label="Valor previsto"><input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
      </div>
      <Campo label="Repetir por N meses">
        <input type="number" min={1} max={60} value={repetir} onChange={(e) => setRepetir(Math.max(1, Number(e.target.value)))} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
      </Campo>
      {erro && <p className="text-sm text-red-600">{erro}</p>}
      <BotoesModal busy={busy} onClose={onClose} onSalvar={salvar} />
    </Overlay>
  )
}

function ModalEditar({ linha, moeda, onClose, onSalvo }: { linha: LinhaDesp; moeda: Moeda; onClose: () => void; onSalvo: () => void }) {
  const [valor, setValor] = useState(String(linha.valor_previsto))
  const [busy, setBusy] = useState(false)
  const salvar = async () => {
    setBusy(true)
    await fetch('/api/planejamento/despesas', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: linha.ids, valor_previsto: Number(valor) }),
    })
    setBusy(false)
    onSalvo()
  }
  return (
    <Overlay onClose={onClose} titulo={`Editar previsão · ${rotuloMes(linha.mes)}`}>
      <p className="text-xs text-slate-400">Valores em {moeda}.</p>
      <Campo label="Valor previsto"><input type="number" step="0.01" value={valor} onChange={(e) => setValor(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" /></Campo>
      <BotoesModal busy={busy} onClose={onClose} onSalvar={salvar} />
    </Overlay>
  )
}
