import { TransacaoParsed } from './parsers/excel'

export type SaldoDia = { data: string; saldo: number }

const round = (x: number) => Math.round(x * 100) / 100

/**
 * Resolve os sinais (crédito/débito) das transações usando os saldos de fim de
 * dia do documento como gabarito. Para cada dia, encontra a atribuição de sinais
 * cujo somatório bate o movimento líquido (saldo_dia − saldo_anterior). Se nenhum
 * conjunto fechar, tenta descartar um lançamento espúrio (ex: saldo de abertura
 * repetido). Dias que não fecham são mantidos com o palpite original e marcados.
 *
 * A IA extrai magnitudes/datas/descrições/saldos com boa precisão; os sinais
 * (coluna ENTRADA vs SAÍDA) se perdem no texto, então são reconstruídos aqui de
 * forma determinística e provadamente consistente com os saldos do documento.
 */
export function resolverSinais(
  saldoInicial: number,
  transacoes: TransacaoParsed[],
  saldosDia: SaldoDia[]
): { transacoes: TransacaoParsed[]; diasNaoResolvidos: string[] } {
  const byDay: Record<string, TransacaoParsed[]> = {}
  for (const t of transacoes) (byDay[t.data] ??= []).push(t)

  const saldoMap: Record<string, number> = {}
  for (const s of saldosDia) saldoMap[s.data] = Number(s.saldo)
  const dias = saldosDia.map((s) => s.data).sort()

  const finais: TransacaoParsed[] = []
  const diasNaoResolvidos: string[] = []
  let prev = saldoInicial

  // Lança no resultado as transações de dias sem saldo informado, sem alteração
  const diasComSaldo = new Set(dias)
  for (const t of transacoes) if (!diasComSaldo.has(t.data)) finais.push(t)

  for (const dia of dias) {
    const txs = byDay[dia] ?? []
    const target = round(saldoMap[dia] - prev)
    const n = txs.length

    // Limite de segurança para a busca exaustiva (2^n)
    if (n <= 18) {
      let melhor: { mask: number; drop: number } | null = null
      let melhorConcorda = -1
      // 1) tenta sem descartar nada
      for (let mask = 0; mask < (1 << n); mask++) {
        let soma = 0
        for (let i = 0; i < n; i++) soma += mask & (1 << i) ? txs[i].valor : -txs[i].valor
        if (Math.abs(round(soma) - target) < 0.005) {
          let concorda = 0
          for (let i = 0; i < n; i++) if (!!(mask & (1 << i)) === (txs[i].tipo === 'credito')) concorda++
          if (concorda > melhorConcorda) { melhorConcorda = concorda; melhor = { mask, drop: -1 } }
        }
      }
      if (melhor) {
        txs.forEach((t, i) => { t.tipo = melhor!.mask & (1 << i) ? 'credito' : 'debito' })
        finais.push(...txs)
        prev = saldoMap[dia]
        continue
      }
      // 2) tenta descartar um lançamento espúrio
      let resolvido = false
      for (let d = 0; d < n && !resolvido; d++) {
        const rest = txs.filter((_, i) => i !== d)
        const m = rest.length
        for (let mask = 0; mask < (1 << m); mask++) {
          let soma = 0
          for (let i = 0; i < m; i++) soma += mask & (1 << i) ? rest[i].valor : -rest[i].valor
          if (Math.abs(round(soma) - target) < 0.005) {
            rest.forEach((t, i) => { t.tipo = mask & (1 << i) ? 'credito' : 'debito' })
            finais.push(...rest)
            resolvido = true
            break
          }
        }
      }
      if (resolvido) { prev = saldoMap[dia]; continue }
    }

    // Não resolveu: mantém palpite e marca o dia
    diasNaoResolvidos.push(dia)
    finais.push(...txs)
    prev = saldoMap[dia]
  }

  // Ordena cronologicamente
  finais.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0))
  return { transacoes: finais, diasNaoResolvidos }
}
