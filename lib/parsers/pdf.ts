import * as pdfParseLib from 'pdf-parse'
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pdfParse = (pdfParseLib as any).default ?? pdfParseLib
import { TransacaoParsed } from './excel'

// Padrões de linha para extratos bancários brasileiros
const PATTERNS = [
  // DD/MM/YYYY descrição valor (com ou sem sinal)
  /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-+]?\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*$/,
  // DD/MM/YYYY descrição R$ valor
  /(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+R\$\s*([-+]?\d{1,3}(?:\.\d{3})*(?:,\d{2}))/,
  // YYYY-MM-DD descricao valor
  /(\d{4}-\d{2}-\d{2})\s+(.+?)\s+([-+]?\d+[.,]\d{2})\s*$/,
]

function parseDate(raw: string): string | null {
  // DD/MM/YYYY → YYYY-MM-DD
  const dmyMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (dmyMatch) return `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw

  return null
}

function parseValor(raw: string): number {
  // Remove pontos de milhar e converte vírgula para ponto
  return parseFloat(raw.replace(/\./g, '').replace(',', '.'))
}

export async function parsePDF(buffer: ArrayBuffer): Promise<TransacaoParsed[]> {
  const uint8 = new Uint8Array(buffer)
  const nodeBuffer = Buffer.from(uint8)

  const data = await pdfParse(nodeBuffer)
  const lines = data.text.split('\n').map((l: string) => l.trim()).filter(Boolean)

  const transacoes: TransacaoParsed[] = []

  for (const line of lines) {
    for (const pattern of PATTERNS) {
      const match = line.match(pattern)
      if (!match) continue

      const data = parseDate(match[1])
      if (!data) continue

      const descricao = match[2].trim()
      const rawValor = match[3]
      const numValor = parseValor(rawValor)

      if (isNaN(numValor) || numValor === 0) continue

      transacoes.push({
        data,
        descricao,
        valor: Math.abs(numValor),
        tipo: numValor >= 0 ? 'credito' : 'debito',
      })
      break
    }
  }

  return transacoes
}
