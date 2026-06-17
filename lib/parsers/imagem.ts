import { extrairExtratoImagens, type ImagemExtrato } from '../claude'
import { resolverSinais } from '../extrato-solver'
import type { TransacaoParsed } from './excel'
import type { ExtratoPDFResult } from './pdf'

const MEDIA_TYPES: Record<string, ImagemExtrato['mediaType']> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
}

export const EXT_IMAGEM = Object.keys(MEDIA_TYPES)

export function ehImagem(nome: string, mime?: string): boolean {
  if (mime?.startsWith('image/')) return true
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  return ext in MEDIA_TYPES
}

function mediaType(nome: string, mime?: string): ImagemExtrato['mediaType'] {
  if (mime && ['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(mime)) return mime as ImagemExtrato['mediaType']
  const ext = nome.split('.').pop()?.toLowerCase() ?? ''
  return MEDIA_TYPES[ext] ?? 'image/png'
}

/**
 * Monta um extrato a partir de um ou mais prints de tela (do MESMO extrato).
 * A IA une os prints e remove sobreposições; os sinais são resolvidos pelo
 * solver determinístico, igual ao fluxo de PDF.
 */
export async function parseExtratoImagens(
  imagens: { buffer: ArrayBuffer; nome: string; mime?: string }[]
): Promise<ExtratoPDFResult> {
  if (!imagens.length) throw new Error('Nenhuma imagem fornecida')
  const payload: ImagemExtrato[] = imagens.map((i) => ({
    base64: Buffer.from(new Uint8Array(i.buffer)).toString('base64'),
    mediaType: mediaType(i.nome, i.mime),
  }))

  const extraido = await extrairExtratoImagens(payload)
  const tx: TransacaoParsed[] = (extraido.transacoes ?? []).map((t) => ({
    data: t.data, descricao: t.descricao, valor: Math.abs(Number(t.valor)), tipo: t.tipo === 'credito' ? 'credito' : 'debito',
  }))
  const saldosPorData: Record<string, number> = {}
  for (const s of extraido.saldos_dia ?? []) saldosPorData[s.data] = Number(s.saldo) // dedup por data
  const saldosDia = Object.entries(saldosPorData).map(([data, saldo]) => ({ data, saldo })).sort((a, b) => (a.data < b.data ? -1 : 1))

  const saldoInicial = extraido.saldo_inicial ?? 0
  const { transacoes, diasNaoResolvidos } = resolverSinais(saldoInicial, tx, saldosDia)
  return { transacoes, saldoInicial, saldosDia, diasNaoResolvidos }
}
