'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useEmpresas } from '../_components/EmpresaProvider'
import Combobox, { type Opcao } from '../_components/Combobox'
import { fmtMoeda, type Moeda } from '@/lib/formato'

type Conta = {
  id: string; nome: string; banco: string; tipo: 'corrente' | 'cartao' | 'emprestimo'; saldo_inicial?: number
  empresa_id?: string | null; empresas?: { id: string; nome: string; moeda: Moeda } | null
}
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
  transferencia_id: string | null
  transferencia_contraparte: string | null
  confianca: number | null
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

const fmtData = (s: string) => { const [a, m, d] = s.split('-'); return `${d}/${m}/${a}` }
const MESES_PT = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const parseNum = (s: string) => Number(String(s).replace(/\./g, '').replace(',', '.')) || 0
const NOVO_CLIENTE = '__novo_cliente__'
const NOVO_FORNECEDOR = '__novo_fornecedor__'
const pessoaValueDe = (l: { cliente_id: string | null; fornecedor_id: string | null }) =>
  l.cliente_id ? `c:${l.cliente_id}` : l.fornecedor_id ? `f:${l.fornecedor_id}` : ''

export default function ContasExtratoPage() {
  const { selecionadas: empresasSelecionadas } = useEmpresas()
  const [contas, setContas] = useState<Conta[]>([])
  const [contaId, setContaId] = useState<string>('')
  const [ext, setExt] = useState<ExtratoResp | null>(null)
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [modalNovo, setModalNovo] = useState(false)

  // Filtros (client-side sobre os lançamentos já carregados)
  const [fAno, setFAno] = useState('')            // '' = todos os anos
  const [fMeses, setFMeses] = useState<Set<number>>(new Set()) // meses 1-12; vazio = todos
  const [fPessoa, setFPessoa] = useState('')      // pessoaValue: 'c:..' | 'f:..' | '' = todos
  const [fConta, setFConta] = useState('')        // conta_contabil_id | '__sem__' | '' = todos

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
      const savedConta = typeof window !== 'undefined' ? localStorage.getItem('extrato_conta') : null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const existe = d.contas.find((c: any) => c.id === savedConta)
      setContaId(existe ? savedConta! : d.contas[0]?.id ?? '')
    })
  }, [])

  useEffect(() => { if (typeof window !== 'undefined' && contaId) localStorage.setItem('extrato_conta', contaId) }, [contaId])

  // Carrega TODOS os lançamentos da conta; a filtragem por período/pessoa/conta
  // é feita client-side (o saldo do dia vem calculado sobre todo o histórico).
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
  const moedaConta = ext?.conta.empresas?.moeda ?? 'BRL'

  // Anos disponíveis e meses do ano selecionado (para o filtro de período)
  const anos = useMemo(() => Array.from(new Set((ext?.lancamentos ?? []).map((l) => l.data.slice(0, 4)))).sort().reverse(), [ext])
  const mesesDoAno = useMemo(() => {
    const set = new Set<number>()
    for (const l of ext?.lancamentos ?? []) if (!fAno || l.data.startsWith(fAno)) set.add(Number(l.data.slice(5, 7)))
    return Array.from(set).sort((a, b) => a - b)
  }, [ext, fAno])

  // Lançamentos após os filtros client-side (ano, meses, pessoa, conta contábil)
  const lancamentosFiltrados = useMemo(() => (ext?.lancamentos ?? []).filter((l) => {
    if (fAno && !l.data.startsWith(fAno)) return false
    if (fMeses.size && !fMeses.has(Number(l.data.slice(5, 7)))) return false
    if (fPessoa && pessoaValueDe(l) !== fPessoa) return false
    if (fConta === '__sem__' ? !!l.conta_contabil_id : fConta && l.conta_contabil_id !== fConta) return false
    return true
  }), [ext, fAno, fMeses, fPessoa, fConta])

  const dias = useMemo(() => {
    const map = new Map<string, Lancamento[]>()
    for (const l of lancamentosFiltrados) { if (!map.has(l.data)) map.set(l.data, []); map.get(l.data)!.push(l) }
    return Array.from(map.entries()).map(([data, lancs]) => ({ data, lancs }))
  }, [lancamentosFiltrados])

  // Opções dos comboboxes de linha (pessoa e conta contábil), compartilhadas
  const pessoaOpcoes: Opcao[] = useMemo(() => [
    { value: '', label: '—' },
    { value: NOVO_CLIENTE, label: '➕ Novo cliente…', fixa: true },
    { value: NOVO_FORNECEDOR, label: '➕ Novo fornecedor…', fixa: true },
    ...(ext?.clientes ?? []).map((c) => ({ value: `c:${c.id}`, label: c.nome, grupo: 'Clientes' })),
    ...(ext?.fornecedores ?? []).map((f) => ({ value: `f:${f.id}`, label: f.nome, grupo: 'Fornecedores' })),
  ], [ext])
  const contaOpcoes: Opcao[] = useMemo(() => [
    { value: '', label: '—' },
    ...planoFolhas.map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}`, grupo: 'Conta contábil' })),
    ...contas.filter((c) => c.id !== contaId).map((c) => ({ value: `transf:${c.id}`, label: `⇄ ${c.nome}${c.empresas?.moeda && c.empresas.moeda !== moedaConta ? ` (${c.empresas.moeda})` : ''}`, grupo: 'Transferência para' })),
  ], [planoFolhas, contas, contaId, moedaConta])

  // Opções dos filtros do topo
  const filtroPessoaOpcoes: Opcao[] = useMemo(() => [
    { value: '', label: 'Cliente/Fornecedor: todos' },
    ...(ext?.clientes ?? []).map((c) => ({ value: `c:${c.id}`, label: c.nome, grupo: 'Clientes' })),
    ...(ext?.fornecedores ?? []).map((f) => ({ value: `f:${f.id}`, label: f.nome, grupo: 'Fornecedores' })),
  ], [ext])
  const filtroContaOpcoes: Opcao[] = useMemo(() => [
    { value: '', label: 'Conta contábil: todas' },
    { value: '__sem__', label: '(sem conta contábil)' },
    ...planoFolhas.map((p) => ({ value: p.id, label: `${p.codigo} · ${p.nome}` })),
  ], [planoFolhas])

  const patch = async (body: Record<string, unknown>) => {
    setBusy(true); setErro(null)
    try {
      const res = await fetch('/api/extrato', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      carregar(contaId)
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
    try { await fetch(`/api/extrato?id=${l.id}`, { method: 'DELETE' }); carregar(contaId) } finally { setBusy(false) }
  }
  // confirma a sugestão automática (some o índice de confiança)
  const confirmarSugestao = (l: Lancamento) => patch({ id: l.id, confirmar: true })

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
      setConcModal(false); carregar(contaId)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }
  const toggleConc = (id: string) => setConcSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

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
      carregar(contaId)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  // Lista do seletor principal: só contas das empresas selecionadas globalmente.
  // O destino de transferência (mais abaixo) usa `contas` sem filtro — qualquer
  // conta de qualquer empresa pode ser contrapartida.
  const contasView = useMemo(
    () => contas.filter((c) => !empresasSelecionadas.length || empresasSelecionadas.includes(c.empresa_id ?? '')),
    [contas, empresasSelecionadas]
  )
  const correntes = contasView.filter((c) => c.tipo === 'corrente')
  const cartoes = contasView.filter((c) => c.tipo === 'cartao')
  const emprestimos = contasView.filter((c) => c.tipo === 'emprestimo')

  // Se a empresa selecionada globalmente mudar e a conta atual não pertencer
  // mais à visão filtrada, troca para a primeira conta disponível nela. Ajuste
  // feito durante o render (padrão React para "resetar estado quando algo
  // externo muda"), não em useEffect — evita reentrâncias e renders em cascata.
  const contasViewKey = contasView.map((c) => c.id).join(',')
  const [contasViewKeyAnterior, setContasViewKeyAnterior] = useState(contasViewKey)
  if (contasViewKey !== contasViewKeyAnterior) {
    setContasViewKeyAnterior(contasViewKey)
    if (contasView.length && !contasView.some((c) => c.id === contaId)) setContaId(contasView[0].id)
  }

  const fmt = useCallback((v: number) => fmtMoeda(v, moedaConta), [moedaConta])

  // marca/desmarca um lançamento existente como transferência para outra conta
  const marcarTransferencia = async (l: Lancamento, destinoId: string) => {
    // Contas de empresas com moedas diferentes: o valor recebido do outro lado
    // não é calculado automaticamente (câmbio/spread real do banco) — pede para
    // o usuário informar o valor de fato lançado na conta de destino.
    const destinoConta = contas.find((c) => c.id === destinoId)
    const moedaDestino = destinoConta?.empresas?.moeda
    let valorContraparte: number | undefined
    if (moedaDestino && moedaDestino !== moedaConta) {
      const resp = window.prompt(`Contas em moedas diferentes (${moedaConta} → ${moedaDestino}).\nValor recebido em ${moedaDestino} na conta "${destinoConta?.nome}":`)
      if (resp === null) return // cancelado
      valorContraparte = parseNum(resp)
      if (!valorContraparte || valorContraparte <= 0) { setErro('Valor inválido para a contrapartida.'); return }
    }

    setBusy(true); setErro(null)
    try {
      const d = await fetch('/api/transferencias', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lancamento_id: l.id, conta_destino_id: destinoId, valor_contraparte: valorContraparte }) }).then((r) => r.json())
      if (d.error) throw new Error(d.error)
      carregar(contaId)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }
  const desfazerTransferencia = async (l: Lancamento) => {
    setBusy(true); setErro(null)
    try {
      const d = await fetch(`/api/transferencias?lancamento_id=${l.id}`, { method: 'DELETE' }).then((r) => r.json())
      if (d.error) throw new Error(d.error)
      carregar(contaId)
    } catch (e) { setErro(e instanceof Error ? e.message : 'Erro') } finally { setBusy(false) }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Contas</h1>
          <p className="text-slate-500 mt-1">Extrato cronológico, saldos diários e classificação</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <select value={contaId} onChange={(e) => setContaId(e.target.value)} className="appearance-none border border-slate-300 rounded-lg pl-3 pr-8 py-2 text-sm bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500">
              {contas.length === 0 && <option value="">Nenhuma conta</option>}
              {correntes.length > 0 && <optgroup label="🏦 Contas correntes">{correntes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
              {cartoes.length > 0 && <optgroup label="💳 Cartões">{cartoes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
              {emprestimos.length > 0 && <optgroup label="💰 Empréstimos">{emprestimos.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}</optgroup>}
            </select>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><path d="M6 9l6 6 6-6" /></svg>
          </div>
          <button onClick={conciliar} disabled={!contaId} className="bg-white border border-slate-300 text-slate-700 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-slate-50 disabled:opacity-50">⚖ Conciliar</button>
          <button onClick={() => { setModalNovo(true); setNData('') }} disabled={!contaId} className="bg-slate-800 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-slate-700 disabled:opacity-50">+ Lançamento</button>
          <Link href="/contas/gerenciar" className="text-sm text-slate-500 hover:text-slate-800 px-3 py-2 border border-slate-200 rounded-lg">⚙ Gerenciar</Link>
        </div>
      </div>

      {/* Barra de filtros */}
      {ext && (
        <div className="mb-4 bg-white border border-slate-200 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="relative">
            <select value={fAno} onChange={(e) => { setFAno(e.target.value); setFMeses(new Set()) }} className="appearance-none border border-slate-300 rounded-lg pl-3 pr-8 py-1.5 text-sm bg-white hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-500">
              <option value="">Todos os anos</option>
              {anos.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400"><path d="M6 9l6 6 6-6" /></svg>
          </div>
          <div className="flex flex-wrap gap-1">
            {mesesDoAno.map((m) => {
              const on = fMeses.has(m)
              return (
                <button key={m} onClick={() => setFMeses((s) => { const n = new Set(s); if (n.has(m)) n.delete(m); else n.add(m); return n })}
                  className={`text-xs px-2 py-1 rounded-md border ${on ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}`}>
                  {MESES_PT[m - 1].slice(0, 3)}
                </button>
              )
            })}
            {fMeses.size > 0 && <button onClick={() => setFMeses(new Set())} className="text-xs px-2 py-1 text-slate-400 hover:text-slate-600">limpar</button>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Combobox value={fPessoa} opcoes={filtroPessoaOpcoes} onChange={setFPessoa} placeholder="Cliente/Fornecedor: todos" className="w-52" />
            <Combobox value={fConta} opcoes={filtroContaOpcoes} onChange={setFConta} placeholder="Conta contábil: todas" className="w-52" />
          </div>
        </div>
      )}

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
          <div className="grid grid-cols-[1fr_140px_160px_120px_52px_34px] gap-2 px-4 py-2.5 border-b border-slate-200 text-xs text-slate-500 uppercase tracking-wide font-medium">
            <span>Descrição</span><span>Cliente / Fornecedor</span><span>Conta contábil</span><span className="text-right">Valor</span><span className="text-center" title="Confiança da sugestão">Conf.</span><span></span>
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
                  <div key={l.id} className="grid grid-cols-[1fr_140px_160px_120px_52px_34px] gap-2 px-4 py-2 items-center border-b border-slate-50 hover:bg-slate-50/50">
                    <div className="text-sm text-slate-700 truncate" title={l.descricao}>
                      {l.descricao}{l.manual && <span className="ml-1 text-[10px] text-slate-400">(manual)</span>}
                    </div>
                    {l.transferencia_id ? (
                      <div className="col-span-2 text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 font-medium whitespace-nowrap">⇄ Transferência</span>
                        <span className="truncate">{l.tipo === 'debito' ? 'para' : 'de'} {l.transferencia_contraparte ?? '—'}</span>
                        <button onClick={() => desfazerTransferencia(l)} disabled={busy} className="ml-auto text-xs font-medium text-slate-500 hover:text-red-600 border border-slate-200 hover:border-red-200 rounded px-2 py-0.5 whitespace-nowrap" title="Reverte a transferência: remove o espelho e o lançamento volta a ser editável">↩ Desfazer</button>
                      </div>
                    ) : (
                      <>
                        <Combobox value={pessoaValue(l)} opcoes={pessoaOpcoes} disabled={busy} placeholder="—" onChange={(v) => onPessoaChange(l, v)} />
                        <Combobox value={l.conta_contabil_id ?? ''} opcoes={contaOpcoes} disabled={busy} placeholder="—"
                          onChange={(v) => { if (v.startsWith('transf:')) marcarTransferencia(l, v.slice(7)); else patch({ id: l.id, conta_contabil_id: v }) }} />
                      </>
                    )}
                    <div className="flex items-center justify-end gap-1">
                      <input type="text" inputMode="decimal" defaultValue={fmtNum(l.valor)} disabled={busy}
                        onBlur={(e) => { const v = parseNum(e.target.value); if (v !== l.valor) patch({ id: l.id, valor: v }); else e.target.value = fmtNum(l.valor) }}
                        className={`w-24 border border-slate-200 rounded px-2 py-1 text-xs text-right font-medium ${l.tipo === 'credito' ? 'text-green-600' : 'text-red-600'}`} />
                      <select value={l.tipo} disabled={busy || !!l.transferencia_id} onChange={(e) => patch({ id: l.id, tipo: e.target.value })}
                        className={`border border-slate-200 rounded px-1 py-1 text-xs font-medium ${l.tipo === 'credito' ? 'text-green-600' : 'text-red-600'} disabled:opacity-60`}>
                        <option value="credito">C</option>
                        <option value="debito">D</option>
                      </select>
                    </div>
                    <div className="flex justify-center">
                      {l.confianca != null && !l.transferencia_id ? (
                        <button
                          onClick={() => confirmarSugestao(l)}
                          disabled={busy}
                          title={`Sugestão automática (${Math.round(l.confianca * 100)}% de confiança). Clique para confirmar.`}
                          className={`text-[11px] font-semibold px-1.5 py-0.5 rounded-full hover:ring-2 hover:ring-offset-1 ${
                            l.confianca >= 0.85 ? 'bg-green-100 text-green-700 hover:ring-green-300'
                            : l.confianca >= 0.6 ? 'bg-amber-100 text-amber-700 hover:ring-amber-300'
                            : 'bg-red-100 text-red-700 hover:ring-red-300'
                          }`}
                        >
                          {Math.round(l.confianca * 100)}%
                        </button>
                      ) : null}
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
