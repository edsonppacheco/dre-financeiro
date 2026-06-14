import { TransacaoParsed } from './excel'
import { extrairExtratoPDF } from '../claude'
import { resolverSinais, type SaldoDia } from '../extrato-solver'

export type ExtratoPDFResult = {
  transacoes: TransacaoParsed[]
  saldoInicial: number | null
  saldosDia: SaldoDia[]
  diasNaoResolvidos: string[]
}

// Extrai o texto do PDF. Usa pdf-parse@1.x via o módulo interno
// ('pdf-parse/lib/pdf-parse.js'), que evita o código de debug do index.js e usa
// um pdfjs compatível com Node serverless (o pdf-parse v2 quebra com "DOMMatrix
// is not defined" no runtime da Vercel). Import dinâmico (lazy) por segurança.
async function extrairTexto(buffer: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('pdf-parse/lib/pdf-parse.js')) as any
  const pdfParse = mod.default ?? mod
  const data = await pdfParse(Buffer.from(new Uint8Array(buffer)))
  return (data?.text as string) ?? ''
}

/**
 * Parser de extrato em PDF: extrai o texto, usa a IA para estruturar transações
 * e saldos, e reconstrói os sinais (crédito/débito) de forma determinística pelo
 * solver, validando contra os saldos diários do documento.
 */
// Divide o texto em pedaços para extração da IA, quebrando em limites de "dia"
// (linhas que começam com data) para não cortar transações no meio. Extratos
// grandes (vários meses) excedem o limite de tokens de uma única chamada.
const REGEX_DIA = /^\s*\d{1,2}[\s/](jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|\d{2})/i
function dividirEmChunks(texto: string, maxChars = 7000): string[] {
  const linhas = texto.split('\n')
  const chunks: string[] = []
  let atual: string[] = []
  let tam = 0
  for (const linha of linhas) {
    const ehDia = REGEX_DIA.test(linha)
    if (tam > maxChars && ehDia && atual.length) {
      chunks.push(atual.join('\n'))
      atual = []
      tam = 0
    }
    atual.push(linha)
    tam += linha.length + 1
  }
  if (atual.length) chunks.push(atual.join('\n'))
  return chunks.length ? chunks : [texto]
}

// Núcleo compartilhado (PDF e Excel): texto -> transações + saldos via IA +
// solver determinístico de sinais. Divide em pedaços para extratos grandes.
export async function parseTextoExtrato(texto: string): Promise<ExtratoPDFResult> {
  if (!texto?.trim()) throw new Error('Não foi possível extrair texto do arquivo')
  const chunks = dividirEmChunks(texto)
  const resultados = await Promise.all(chunks.map((c) => extrairExtratoPDF(c)))
  const saldoInicial = resultados[0]?.saldo_inicial ?? 0
  const tx: TransacaoParsed[] = []
  const saldosPorData: Record<string, number> = {}
  for (const extraido of resultados) {
    for (const t of extraido.transacoes) {
      tx.push({ data: t.data, descricao: t.descricao, valor: Math.abs(Number(t.valor)), tipo: t.tipo === 'credito' ? 'credito' : 'debito' })
    }
    for (const s of extraido.saldos_dia) saldosPorData[s.data] = Number(s.saldo) // dedup por data
  }
  const saldosDia = Object.entries(saldosPorData).map(([data, saldo]) => ({ data, saldo })).sort((a, b) => (a.data < b.data ? -1 : 1))
  const { transacoes, diasNaoResolvidos } = resolverSinais(saldoInicial, tx, saldosDia)
  return { transacoes, saldoInicial, saldosDia, diasNaoResolvidos }
}

export async function parsePDF(buffer: ArrayBuffer): Promise<ExtratoPDFResult> {
  const texto = await extrairTexto(buffer)
  return parseTextoExtrato(texto)
}
