// Formatação de moeda ciente da moeda da empresa (BRL / USD).
// Antes a formatação era hardcoded em BRL espalhada pelas páginas.

export type Moeda = 'BRL' | 'USD'

export const MOEDAS: { value: Moeda; label: string; simbolo: string }[] = [
  { value: 'BRL', label: 'Real (R$)', simbolo: 'R$' },
  { value: 'USD', label: 'Dólar (US$)', simbolo: 'US$' },
]

// Locale por moeda (pt-BR para Real, en-US para Dólar)
const LOCALE: Record<Moeda, string> = { BRL: 'pt-BR', USD: 'en-US' }

export function fmtMoeda(valor: number, moeda: Moeda = 'BRL'): string {
  const m = (moeda === 'USD' ? 'USD' : 'BRL') as Moeda
  return (valor ?? 0).toLocaleString(LOCALE[m], { style: 'currency', currency: m })
}

export const simboloMoeda = (moeda: Moeda = 'BRL') =>
  MOEDAS.find((x) => x.value === moeda)?.simbolo ?? 'R$'
