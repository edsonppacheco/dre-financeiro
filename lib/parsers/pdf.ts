import { TransacaoParsed } from './excel'
import { extrairExtratoPDF } from '../claude'
import { resolverSinais, type SaldoDia } from '../extrato-solver'

export type ExtratoPDFResult = {
  transacoes: TransacaoParsed[]
  saldoInicial: number | null
  saldosDia: SaldoDia[]
  diasNaoResolvidos: string[]
}

// Extrai o texto do PDF. O pdf-parse v2 expõe a classe PDFParse; import dinâmico
// porque a lib (baseada em pdfjs) não deve ser carregada no topo do módulo em
// ambiente serverless.
async function extrairTexto(buffer: ArrayBuffer): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod = (await import('pdf-parse')) as any
  const PDFParse = mod.PDFParse ?? mod.default?.PDFParse
  if (!PDFParse) throw new Error('pdf-parse: PDFParse indisponível')
  const parser = new PDFParse({ data: Buffer.from(new Uint8Array(buffer)) })
  try {
    const { text } = await parser.getText()
    return text as string
  } finally {
    await parser.destroy?.()
  }
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
