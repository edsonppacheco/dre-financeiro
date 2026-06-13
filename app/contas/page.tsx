'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

type Conta = { id: string; nome: string; banco: string; tipo: 'corrente' | 'cartao' | 'emprestimo'; saldo_inicial?: number }
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
  meses: string[]
  saldoDocumentoPorData: Record<string, number>
  saldoCalculadoFimDia: Record<string, number>
  alertas: Record<string, { calculado: number; documento: number; diff: number }>
  planoContas: PlanoConta[]
  clientes: Pessoa[]
  fornecedores: Pessoa[]
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const parseNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0
const NOVO_CLIENTE = '__novo_cliente__'
const NOVO_FORNECEDOR = '__novo_fornecedor__'

export default function ContasExtratoPage() {
  const [contas, setContas] = useState<Conta[]>([])
  const [contaId, setContaId] = useState<string>('')
  const [ext, setExt] = useState<ExtratoResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [mes, setMes] = useState('')
  const [modalNovo, setModalNovo] = useState(false)

  // form de lançamento manual
  const [nData, setNData] = useState('')
  const [nDescricao, setNDescricao] = useState('')
  const [nValor, setNValor] = useState('')
  const [nTipo, setNTipo] = useState<'credito' | 'debito'>('debito')

  // modal de criar cliente/fornecedor a partir de um lançamento
  const [pessoaModal, setPessoaModal] = useState<{ tipo: 'cliente' | 'fornecedor'; lancamentoId: string } | null>(null)
  const [pNome, setPNome] = useState('')

  useEffect(() => {
    fetch('/api/contas').then((r) => r.json()).then((d) => {
      if (!d.contas) return
      setContas(d.contas)
      // Restaura a última visualização (conta + período)
      const savedConta = typeof window !== 'undefined' ? localStorage.getItem('extrato_conta') : null
      const savedMes = typeof window !== 'undefined' ? localStorage.getItem('extrato_mes') : null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existe = d.contas.find((c: any) => c.id === savedConta)
      setContaId(existe ? savedConta! : d.contas[0]?.id ?? '')
      if (savedMes) setMes(savedMes)
    })
  }, [])

  // Salva a última visualização
  useEffect(() => {
    if (typeof window === 'undefined' || !contaId) return
    localStorage.setItem('extrato_conta', contaId)
    localStorage.setItem('extrato_mes', mes)
  }, [contaId, mes])

  const carregar = useCallback((id: string, mesArg: string) => {
    if (!id) return
    const qs = mesArg ? `&mes=${mesArg}` : ''
    fetch(`/api/extrato?conta_id=${id}${qs}`)
      .then((r) => r.json())
      .then((d) => { if (d.error) throw new Error(d.error); setExt(d) })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { if (contaId) carregar(contaId, mes) }, [contaId, mes, carregar])

  const planoFolhas = useMemo(
    () => (ext?.planoContas ?? []).filter((p) => p.tipo !== 'grupo'),
    [ext]
  )

  const anosDosMeses = useMemo(
    () => Array.from(new Set((ext?.meses ?? []).map((m) => m.split('-')[0]))),
    [ext]
  )

  // agrupa lançamentos por dia (já vêm em ordem cronológica)
  const dias = useMemo(() => {
    const map = new Map<string, Lancamento[]>()
    for (const l of ext?.lancamentos ?? []) {
      if (!map.has(l.data)) map.set(l.data, [])
      map.get(l.data)!.push(l)
    }
    return Array.from(map.entries()).map(([data, lancs]) => ({ data, lancs }))
  }, [ext])

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/extrato', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      carregar(contaId, mes)
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
      carregar(contaId, mes)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const remover = async (l: Lancamento) => {
    if (!confirm(`Remover o lançamento "${l.descricao}"?`)) return
    setBusy(true)
    try { await fetch(`/api/extrato?id=${l.id}`, { method: 'DELETE' }); carregar(contaId, mes) } finally { setBusy(false) }
  }

  // conciliação de extratos sobrepostos
  type ConcItem = { id: string; data: string; valor: number; tipo: string; descricao: string; motivo?: string }
  type ConcPar = { overlap: { inicio: string; fim: string }; anterior: { id: string; periodo: string }; prevalece: { id: string; periodo: string }; duplicatas: ConcItem[]; ambiguos: ConcItem[] }
  const [concModal, setConcModal] = useState(false)
  const [concPares, setConcPares] = useState<ConcPar[] | null>(null)
  const [concSel, setConcSel] = useState<Set<string>>(new Set())
  const conciliar = async () => {
    setConcModal(true); setConcPares(null); setErro(null)
    try {
      const d = await fetch(`/api/conciliacao?conta_id=${contaId}`).then((r) => r.json())
      if (d.error) throw new Error(d.error)
      setConcPares(d.pares)
      // duplicatas confiáveis já vêm marcadas
      const sel = new Set<string>()
      for (const p of d.pares as ConcPar[]) for (const x of p.duplicatas) sel.add(x.id)
      setConcSel(sel)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro'); setConcModal(false) }
  }
  const aplicarConciliacao = async () => {
    const remover = Array.from(concSel)
    if (!remover.length) { setConcModal(false); return }
    setBusy(true)
    try {
      const d = await fetch('/api/conciliacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ remover }) }).then((r) => r.json())
      if (d.error) throw new Error(d.error)
      setConcModal(false); carregar(contaId, mes)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }
  const toggleConc = (id: string) => setConcSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const [sugerindo, setSugerindo] = useState(false)
  const sugerirContas = async () => {
    setSugerindo(true); setErro(null)
    try {
      const res = await fetch('/api/classificar-contabil', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conta_id: contaId }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      carregar(contaId, mes)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setSugerindo(false) }
  }

  const pessoaValue = (l: Lancamento) => l.cliente_id ? `c:${l.cliente_id}` : l.fornecedor_id ? `f:${l.fornecedor_id}` : ''
  const onPessoaChange = (l: Lancamento, v: string) => {
    if (v === NOVO_CLIENTE) { setPessoaModal({ tipo: 'cliente', lancamentoId: l.id }); setPNome(''); return }
    if (v === NOVO_FORNECEDOR) { setPessoaModal({ tipo: 'fornecedor', lancamentoId: l.id }); setPNome(''); return }
    if (v.startsWith('c:')) patch({ id: l.id, cliente_id: v.slice(2), fornecedor_id: '' })
    else if (v.startsWith('f:')) patch({ id: l.id, fornecedor_id: v.slice(2), cliente_id: '' })
    else patch({ id: l.id, cliente_id: '', fornecedor_id: '' })
  }

  const criarPessoa = async () => {
    if (!pessoaModal || !pNome.trim()) return
    setBusy(true); setErro(null)
    try {
      const endpoint = pessoaModal.tipo === 'cliente' ? '/api/clientes' : '/api/fornecedores'
      const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nome: pNome }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      const campo = pessoaModal.tipo === 'cliente' ? { cliente_id: d.pessoa.id, fornecedor_id: '' } : { fornecedor_id: d.pessoa.id, cliente_id: '' }
      // vincula ao lançamento e recarrega (traz a nova pessoa na lista)
      await fetch('/api/extrato', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: pessoaModal.lancamentoId, ...campo }) })
      setPessoaModal(null)
      carregar(contaId, mes)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  const correntes = contas.filter((c) => c.tipo === 'corrente')
  const cartoes = contas.filter((c) => c.tipo === 'cartao')
  const emprestimos = contas.filter((c) => c.tipo === 'emprestimo')

  // transferência entre contas
  const [transfModal, setTransfModal] = useState(false)
  const [tDestino, setTDestino] = useState('')
  const [tData, setTData] = useState('')
  const [tValor, setTValor] = useState('')
  const [tDesc, setTDesc] = useState('')
  const criarTransferencia = async () => {
    if (!contaId || !tDestino || !tData || !tValor) return
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/transferencias', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conta_origem_id: contaId, conta_destino_id: tDestino, data: tData, valor: parseNum(tValor), descricao: tDesc || null }) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setTransfModal(false); setTDestino(''); setTValor(''); setTDesc('')
      carregar(contaId, mes)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contas</h1>
          <p className="text-slate-500 mt-1">Extrato cronológico, saldos diários e classificação</p>
        </div>
        <div className="flex items-center gap-2">
          <select value={contaId} onChange={(e) => { setContaId(e.target.value); setMes('') }} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500">
            {contas.length === 0 && <option value="">Nenhuma conta</option>}
            {correntes.length > 0 && <optgroup label="🏦 Contas correntes">{correntes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
            {cartoes.length > 0 && <optgroup label="💳 Cartões">{cartoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
            {emprestimos.length > 0 && <optgroup label="💰 Empréstimos">{emprestimos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
          </select>
          <select value={mes} onChange={(e) => setMes(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-slate-500" title="Filtrar por período">
            <option value="">📅 Todos os períodos</option>
            {anosDosMeses.map((ano) => (
              <optgroup key={ano} label={ano}>
                {(ext?.meses ?? []).filter((m) => m.startsWith(ano)).map((m) => {
                  const mm = Number(m.split('-')[1])
                  return <option key={m} value={m}>{MESES_PT[mm - 1]}</option>
                })}
              </optgroup>
            ))}
          </select>
          <button onClick={sugerirContas} disabled={!contaId || sugerindo} className="bg-violet-600 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-violet-700 disabled:opacity-50">{sugerindo ? 'Classificando…' : '✨ Sugerir contas'}</button>
          <button onClick={conciliar} disabled={!contaId} className="bg-white border border-slate-300 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">⚖ Conciliar</button>
          <button onClick={() => { setTransfModal(true); setTData('') }} disabled={!contaId || contas.length < 2} className="bg-white border border-slate-300 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">⇄ Transferir</button>
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
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* cabeçalho */}
          <div className="grid grid-cols-[1fr_150px_180px_130px_40px] gap-2 px-4 py-2.5 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide font-medium">
            <span>Descrição</span><span>Cliente / Fornecedor</span><span>Conta contábil</span><span className="text-right">Valor</span><span></span>
          </div>

          {dias.map(({ data, lancs }) => {
            const saldo = ext.saldoCalculadoFimDia[data]
            const alerta = ext.alertas[data]
            const temDoc = ext.saldoDocumentoPorData[data] !== undefined
            return (
              <div key={data}>
                {/* sub-cabeçalho do dia */}
                <div className="bg-slate-50 px-4 py-1.5 text-xs font-semibold text-slate-500 border-b border-slate-100">{fmtData(data)}</div>
                {lancs.map((l) => (
                  <div key={l.id} className="grid grid-cols-[1fr_150px_180px_130px_40px] gap-2 px-4 py-2 items-center border-b border-slate-50 hover:bg-slate-50/50">
                    <div className="text-sm text-slate-700 truncate" title={l.descricao}>
                      {l.descricao}{l.manual && <span className="ml-1 text-[10px] text-slate-400">(manual)</span>}
                    </div>
                    <select value={pessoaValue(l)} disabled={busy} onChange={(e) => onPessoaChange(l, e.target.value)} className="border border-slate-200 rounded px-2 py-1 text-xs w-full">
                      <option value="">—</option>
                      <option value={NOVO_CLIENTE}>➕ Novo cliente…</option>
                      <option value={NOVO_FORNECEDOR}>➕ Novo fornecedor…</option>
                      <optgroup label="Clientes">{ext.clientes.map((c) => <option key={c.id} value={`c:${c.id}`}>{c.nome}</option>)}</optgroup>
                      <optgroup label="Fornecedores">{ext.fornecedores.map((f) => <option key={f.id} value={`f:${f.id}`}>{f.nome}</option>)}</optgroup>
                    </select>
                    <select value={l.conta_contabil_id ?? ''} disabled={busy} onChange={(e) => patch({ id: l.id, conta_contabil_id: e.target.value })} className="border border-slate-200 rounded px-2 py-1 text-xs w-full">
                      <option value="">—</option>
                      {planoFolhas.map((p) => <option key={p.id} value={p.id}>{p.codigo} · {p.nome}</option>)}
                    </select>
                    <div className="flex items-center justify-end gap-1">
                      <input type="text" inputMode="decimal" defaultValue={fmtNum(l.valor)} disabled={busy}
                        onBlur={(e) => { const v = parseNum(e.target.value); if (v !== l.valor) patch({ id: l.id, valor: v }); else e.target.value = fmtNum(l.valor) }}
                        className={`w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right font-medium ${l.tipo === 'credito' ? 'text-green-600' : 'text-red-600'}`} />
                      <select value={l.tipo} disabled={busy} onChange={(e) => patch({ id: l.id, tipo: e.target.value })}
                        className={`border border-slate-200 rounded px-1 py-1 text-xs font-medium ${l.tipo === 'credito' ? 'text-green-600' : 'text-red-600'}`}>
                        <option value="credito">C</option>
                        <option value="debito">D</option>
                      </select>
                    </div>
                    <button onClick={() => remover(l)} disabled={busy} className="text-slate-300 hover:text-red-500 text-sm text-right">🗑</button>
                  </div>
                ))}
                {/* saldo do dia */}
                <div className="flex items-center justify-end gap-3 px-4 py-2 bg-slate-50/60 border-b border-slate-200 text-sm">
                  {alerta ? (
                    <span className="text-xs text-red-600 font-medium" title={`Documento: ${fmt(alerta.documento)}`}>
                      ⚠ saldo difere — documento: {fmt(alerta.documento)}
                    </span>
                  ) : temDoc ? (
                    <span className="text-xs text-green-600 font-medium">✓ confere com o documento</span>
                  ) : null}
                  <span className="text-slate-500 text-xs">Saldo do dia:</span>
                  <span className={`font-semibold tabular-nums ${saldo < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmt(saldo)}</span>
                </div>
              </div>
            )
          })}
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

      {/* Modal conciliação */}
      {concModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setConcModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-1">Conciliação de extratos</h2>
            <p className="text-xs text-slate-400 mb-4">Detecta transações duplicadas entre extratos com datas sobrepostas. As de alta confiança já vêm marcadas para remoção; revise as dúvidas.</p>
            {concPares === null ? (
              <p className="py-8 text-center text-slate-400 text-sm">Analisando…</p>
            ) : concPares.length === 0 ? (
              <p className="py-8 text-center text-slate-500 text-sm">✓ Nenhuma sobreposição com duplicatas encontrada nesta conta.</p>
            ) : (
              <div className="space-y-5">
                {concPares.map((p, idx) => (
                  <div key={idx} className="border border-slate-200 rounded-lg p-3">
                    <p className="text-xs text-slate-500 mb-2">
                      Sobreposição <b>{fmtData(p.overlap.inicio)}–{fmtData(p.overlap.fim)}</b>. Prevalece o extrato {p.prevalece.periodo}; removendo duplicatas do extrato {p.anterior.periodo}.
                    </p>
                    {p.duplicatas.length > 0 && (
                      <div className="mb-2">
                        <p className="text-[11px] font-semibold text-green-700 uppercase mb-1">Duplicatas (alta confiança)</p>
                        {p.duplicatas.map((x) => (
                          <label key={x.id} className="flex items-center gap-2 text-sm py-1">
                            <input type="checkbox" checked={concSel.has(x.id)} onChange={() => toggleConc(x.id)} />
                            <span className="text-slate-500 w-12">{fmtData(x.data).slice(0, 5)}</span>
                            <span className="flex-1 truncate text-slate-700">{x.descricao}</span>
                            <span className={`tabular-nums ${x.tipo === 'credito' ? 'text-green-600' : 'text-red-600'}`}>{fmt(x.valor)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                    {p.ambiguos.length > 0 && (
                      <div>
                        <p className="text-[11px] font-semibold text-amber-700 uppercase mb-1">Dúvidas (revise)</p>
                        {p.ambiguos.map((x) => (
                          <label key={x.id} className="flex items-center gap-2 text-sm py-1" title={x.motivo}>
                            <input type="checkbox" checked={concSel.has(x.id)} onChange={() => toggleConc(x.id)} />
                            <span className="text-slate-500 w-12">{fmtData(x.data).slice(0, 5)}</span>
                            <span className="flex-1 truncate text-slate-700">{x.descricao}</span>
                            <span className={`tabular-nums ${x.tipo === 'credito' ? 'text-green-600' : 'text-red-600'}`}>{fmt(x.valor)}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setConcModal(false)} className="text-sm text-slate-500 px-3 py-2">Fechar</button>
              {concPares && concPares.length > 0 && (
                <button onClick={aplicarConciliacao} disabled={busy || concSel.size === 0} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Remover {concSel.size} selecionada(s)</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal transferência entre contas */}
      {transfModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setTransfModal(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-1">Transferência entre contas</h2>
            <p className="text-xs text-slate-400 mb-4">Cria dois lançamentos: débito em {contas.find((c) => c.id === contaId)?.nome} e crédito na conta de destino.</p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Para (conta de destino)</label>
                <select value={tDestino} onChange={(e) => setTDestino(e.target.value)} className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm">
                  <option value="">Selecione…</option>
                  {contas.filter((c) => c.id !== contaId).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </div>
              <div className="flex gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Data</label>
                  <input type="date" value={tData} onChange={(e) => setTData(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Valor</label>
                  <input type="text" inputMode="decimal" value={tValor} onChange={(e) => setTValor(e.target.value)} placeholder="0,00" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Descrição (opcional)</label>
                <input value={tDesc} onChange={(e) => setTDesc(e.target.value)} placeholder="Ex: Pagamento da fatura" className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setTransfModal(false)} className="text-sm text-slate-500 px-3 py-2">Cancelar</button>
              <button onClick={criarTransferencia} disabled={busy || !tDestino || !tData || !tValor} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Transferir</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal criar cliente/fornecedor inline */}
      {pessoaModal && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-4 z-50" onClick={() => setPessoaModal(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="font-bold text-slate-800 mb-4">Novo {pessoaModal.tipo}</h2>
            <label className="block text-xs font-medium text-slate-500 mb-1">Nome <span className="text-red-500">*</span></label>
            <input value={pNome} onChange={(e) => setPNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criarPessoa()} autoFocus className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm" />
            <p className="text-xs text-slate-400 mt-2">Você pode completar os outros dados depois em {pessoaModal.tipo === 'cliente' ? 'Clientes' : 'Fornecedores'}.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button onClick={() => setPessoaModal(null)} className="text-sm text-slate-500 px-3 py-2">Cancelar</button>
              <button onClick={criarPessoa} disabled={busy || !pNome.trim()} className="bg-slate-800 text-white text-sm font-semibold px-4 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">Criar e vincular</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
