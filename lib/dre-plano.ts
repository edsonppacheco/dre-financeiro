// Cálculo da DRE sobre o PLANO DE CONTAS (conta_contabil_id das transações).
// Substitui a DRE antiga baseada em linhas_dre/classificacoes.

export type PlanoLinha = { id: string; codigo: string; nome: string; tipo: string; pai_id: string | null; ordem: number }
export type LinhaDreCalc = { codigo: string; nome: string; tipo: string; nivel: number; valor: number }

const round = (x: number) => Math.round(x * 100) / 100

/**
 * Recebe o plano de contas e a soma (com sinal: crédito +, débito −) por
 * conta_contabil_id, e devolve as linhas da DRE com valores + lucro líquido.
 * - Folhas (receita/imposto/despesa/distribuicao): soma direta da conta.
 * - Grupos: soma das folhas descendentes (código que começa com "<codigo>.").
 * - Lucro líquido: soma de todas as folhas (receitas positivas, despesas/impostos negativos).
 */
export function calcularDrePlano(
  plano: PlanoLinha[],
  somaPorConta: Record<string, number>
): { linhas: LinhaDreCalc[]; lucroLiquido: number } {
  const ordenadas = [...plano].sort((a, b) => a.ordem - b.ordem)
  const folhas = ordenadas.filter((p) => p.tipo !== 'grupo')

  const linhas: LinhaDreCalc[] = ordenadas.map((p) => {
    const nivel = p.pai_id ? 1 : 0
    if (p.tipo === 'grupo') {
      const valor = folhas
        .filter((f) => f.codigo.startsWith(p.codigo + '.'))
        .reduce((s, f) => s + (somaPorConta[f.id] ?? 0), 0)
      return { codigo: p.codigo, nome: p.nome, tipo: p.tipo, nivel, valor: round(valor) }
    }
    return { codigo: p.codigo, nome: p.nome, tipo: p.tipo, nivel, valor: round(somaPorConta[p.id] ?? 0) }
  })

  const lucroLiquido = round(folhas.reduce((s, f) => s + (somaPorConta[f.id] ?? 0), 0))
  return { linhas, lucroLiquido }
}
