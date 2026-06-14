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
  // Distribuição de lucros NÃO entra na DRE (é apropriação de lucro, vai no balanço)
  const folhas = ordenadas.filter((p) => p.tipo !== 'grupo' && p.tipo !== 'distribuicao')

  const linhas: LinhaDreCalc[] = ordenadas
    .filter((p) => p.tipo !== 'distribuicao')
    .map((p) => {
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

export type LinhaDreMulti = { codigo: string; nome: string; tipo: string; nivel: number; valores: Record<string, number> }

/**
 * DRE com múltiplas colunas de período. `somasPorColuna` mapeia a chave da
 * coluna -> (conta_contabil_id -> soma com sinal). Reaproveita calcularDrePlano
 * por coluna e monta a matriz linha × coluna.
 */
export function calcularDreMulti(
  plano: PlanoLinha[],
  colunas: string[],
  somasPorColuna: Record<string, Record<string, number>>
): { linhas: LinhaDreMulti[]; lucroLiquido: Record<string, number> } {
  const porColuna: Record<string, ReturnType<typeof calcularDrePlano>> = {}
  for (const col of colunas) porColuna[col] = calcularDrePlano(plano, somasPorColuna[col] ?? {})

  const ordenadas = [...plano].sort((a, b) => a.ordem - b.ordem).filter((p) => p.tipo !== 'distribuicao')
  const linhas: LinhaDreMulti[] = ordenadas.map((p) => {
    const valores: Record<string, number> = {}
    for (const col of colunas) {
      const l = porColuna[col].linhas.find((x) => x.codigo === p.codigo)
      valores[col] = l?.valor ?? 0
    }
    return { codigo: p.codigo, nome: p.nome, tipo: p.tipo, nivel: p.pai_id ? 1 : 0, valores }
  })
  const lucroLiquido: Record<string, number> = {}
  for (const col of colunas) lucroLiquido[col] = porColuna[col].lucroLiquido
  return { linhas, lucroLiquido }
}
