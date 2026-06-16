import * as XLSX from 'xlsx'
import type { TransacaoParsed } from './excel'
import type { SaldoDia } from '../extrato-solver'

// Importador do "Account Register" exportado do QuickBooks Online (QBO).
// Formato (linha de cabeçalho): Date | Ref No. | Payee | Memo | Payment |
// Deposit | Reconciliation Status | Balance | Type | Account | Added in Banking
// - Lê tanto .xls binário quanto .xlsx/.csv (SheetJS).
// - Sinais explícitos: Payment = débito, Deposit = crédito (não precisa solver).
// - Balance por linha (saldo corrente) vira saldo de fim de dia para conciliação.
// - Datas em formato americano MM/DD/YYYY.

export type TransacaoQBO = TransacaoParsed & { categoriaQBO?: string }
export type QBOResult = { transacoes: TransacaoQBO[]; saldoInicial: number | null; saldosDia: SaldoDia[] }

type Linha = (string | number | null)[]

const HEADERS_QBO = ['date', 'payee', 'payment', 'deposit', 'balance']

function lerPlanilha(buffer: ArrayBuffer): Linha[] {
  const wb = XLSX.read(new Uint8Array(buffer), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  if (!ws) return []
  return XLSX.utils.sheet_to_json<Linha>(ws, { header: 1, blankrows: false, defval: '' })
}

// Localiza a linha de cabeçalho do QBO (a que contém Date/Payee/Payment/Deposit/Balance)
function acharCabecalho(rows: Linha[]): { idx: number; col: Record<string, number> } | null {
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const celulas = rows[i].map((c) => String(c ?? '').toLowerCase().trim())
    const presentes = HEADERS_QBO.filter((h) => celulas.includes(h))
    if (presentes.length >= 4) {
      const col: Record<string, number> = {}
      celulas.forEach((c, j) => { if (c) col[c] = j })
      return { idx: i, col }
    }
  }
  return null
}

/** Detecta se o buffer é um Account Register do QBO (qualquer extensão que o SheetJS leia). */
export function ehArquivoQBO(buffer: ArrayBuffer): boolean {
  try {
    return acharCabecalho(lerPlanilha(buffer)) !== null
  } catch {
    return false
  }
}

// "12/29/2025" (MM/DD/YYYY) -> "2025-12-29". Também aceita data já em ISO.
function dataUSparaISO(v: string | number | null): string | null {
  const s = String(v ?? '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (!m) return null
  const [, mm, dd, yyyy] = m
  const mi = Number(mm), di = Number(dd)
  if (mi < 1 || mi > 12 || di < 1 || di > 31) return null
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

const num = (v: string | number | null): number => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v ?? '').replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? 0 : n
}

export function parseQBO(buffer: ArrayBuffer): QBOResult {
  const rows = lerPlanilha(buffer)
  const cab = acharCabecalho(rows)
  if (!cab) throw new Error('Não parece um extrato do QuickBooks (cabeçalho Date/Payee/Payment/Deposit não encontrado).')

  const { idx, col } = cab
  const cData = col['date'], cPayee = col['payee'] ?? -1, cMemo = col['memo'] ?? -1
  const cPay = col['payment'], cDep = col['deposit'], cBal = col['balance'] ?? -1, cAcc = col['account'] ?? -1

  // Linhas vêm em ordem do mais recente para o mais antigo (padrão QBO).
  // Guardamos a ordem original para resolver empates de data corretamente.
  const itens: { data: string; descricao: string; valor: number; tipo: 'credito' | 'debito'; saldo: number | null; categoriaQBO?: string; ordem: number }[] = []
  for (let i = idx + 1; i < rows.length; i++) {
    const r = rows[i]
    const data = dataUSparaISO(r[cData])
    if (!data) continue

    const pay = cPay >= 0 ? num(r[cPay]) : 0
    const dep = cDep >= 0 ? num(r[cDep]) : 0
    if (pay === 0 && dep === 0) continue

    const tipo: 'credito' | 'debito' = dep > 0 ? 'credito' : 'debito'
    const valor = Math.abs(dep > 0 ? dep : pay)

    const payee = cPayee >= 0 ? String(r[cPayee] ?? '').trim() : ''
    const memo = cMemo >= 0 ? String(r[cMemo] ?? '').replace(/\s+/g, ' ').trim() : ''
    const categoriaQBO = cAcc >= 0 ? String(r[cAcc] ?? '').trim() : ''
    const descricao = payee || memo.slice(0, 80) || categoriaQBO || 'Lançamento'

    const saldo = cBal >= 0 && String(r[cBal] ?? '').trim() !== '' ? num(r[cBal]) : null
    itens.push({ data, descricao, valor, tipo, saldo, categoriaQBO: categoriaQBO || undefined, ordem: i })
  }

  if (!itens.length) throw new Error('Nenhuma transação encontrada no extrato do QuickBooks.')

  // Ordem cronológica: por data; empate pela ordem inversa do arquivo (arquivo é
  // do mais novo p/ o mais antigo, então ordem maior = mais antigo no mesmo dia).
  const cronologico = [...itens].sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : b.ordem - a.ordem)

  // Saldo inicial = saldo após a 1ª transação menos o efeito dela
  const primeiro = cronologico[0]
  const saldoInicial = primeiro.saldo !== null
    ? Math.round((primeiro.saldo - (primeiro.tipo === 'credito' ? primeiro.valor : -primeiro.valor)) * 100) / 100
    : null

  // Saldo de fim de dia = saldo da ÚLTIMA transação cronológica de cada data.
  // No arquivo (mais novo primeiro), é a 1ª linha encontrada para a data.
  const saldoFimDia: Record<string, number> = {}
  for (const it of itens) {
    if (it.saldo === null) continue
    if (!(it.data in saldoFimDia)) saldoFimDia[it.data] = it.saldo // 1ª ocorrência = topo = fim do dia
  }
  const saldosDia: SaldoDia[] = Object.entries(saldoFimDia)
    .map(([data, saldo]) => ({ data, saldo }))
    .sort((a, b) => (a.data < b.data ? -1 : 1))

  const transacoes: TransacaoQBO[] = cronologico.map((it) => ({
    data: it.data, descricao: it.descricao, valor: it.valor, tipo: it.tipo, categoriaQBO: it.categoriaQBO,
  }))

  return { transacoes, saldoInicial, saldosDia }
}

// Mapeia a conta do QBO (coluna Account) para um código do plano de contas padrão.
// Conservador: só mapeia categorias claras; ambíguas (aportes, empréstimos,
// transferências internas) ficam null para revisão manual.
export function mapearCategoriaQBO(account: string | undefined, tipo: 'credito' | 'debito'): string | null {
  if (!account) return null
  const a = account.toLowerCase()
  if (/payroll|salaries|wages|salary/.test(a)) return '3.1'
  if (/commission/.test(a)) return '3.2'
  if (/advertis|marketing/.test(a)) return '3.3'
  if (/legal|accounting|professional/.test(a)) return '3.4'
  if (/software|subscription|saas|hosting|cloud|domain/.test(a)) return '3.5'
  if (/partner distribution|dividend|owner.?s? draw/.test(a)) return '3.7'
  if (/\btax(es)?\b|irs|franchise/.test(a)) return '2'
  if (/bank fee|service charge|quickbooks payments fee|general business|office|supplies|software & apps/.test(a)) return '3.6'
  // Receitas: recebimentos de clientes (entram como crédito)
  if (tipo === 'credito' && /accounts receivable|a\/r|payments to deposit|sales|income|revenue|services/.test(a)) return '1'
  return null
}
