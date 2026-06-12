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
export async function parsePDF(buffer: ArrayBuffer): Promise<ExtratoPDFResult> {
  const texto = await extrairTexto(buffer)
  if (!texto?.trim()) throw new Error('Não foi possível extrair texto do PDF')

  const extraido = await extrairExtratoPDF(texto)
  const tx: TransacaoParsed[] = extraido.transacoes.map((t) => ({
    data: t.data,
    descricao: t.descricao,
    valor: Math.abs(Number(t.valor)),
    tipo: t.tipo === 'credito' ? 'credito' : 'debito',
  }))

  const { transacoes, diasNaoResolvidos } = resolverSinais(extraido.saldo_inicial, tx, extraido.saldos_dia)

  return {
    transacoes,
    saldoInicial: extraido.saldo_inicial,
    saldosDia: extraido.saldos_dia,
    diasNaoResolvidos,
  }
}
