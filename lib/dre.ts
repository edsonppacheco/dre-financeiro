// Cálculo da DRE — compartilhado entre a tela (/api/dre) e o export (/api/exportar)
// para que ambos produzam exatamente os mesmos números.

export type LinhaDreBase = {
  codigo: string
  nome: string
  tipo: string // 'receita' | 'custo' | 'despesa' | 'resultado' | 'grupo'
  ordem: number
}

// Uma classificação já cruzada com a transação correspondente.
export type ItemClassificado = {
  linha_dre: string
  corrigido_para: string | null
  valor: number
  tipo: string // 'credito' | 'debito'
}

export type LinhaDreCalculada = LinhaDreBase & { valor: number }

const isFolha = (tipo: string) => tipo !== 'grupo' && tipo !== 'resultado'

/**
 * Calcula o valor de cada linha da DRE para um conjunto de classificações.
 *
 * - Folhas (receita/custo/despesa): soma das transações classificadas nela,
 *   usando a classificação efetiva (corrigido_para ?? linha_dre). Crédito soma
 *   positivo, débito soma negativo.
 * - Grupos: soma das folhas descendentes (código que começa com "<codigo>.").
 * - Resultados (subtotais): acumulado de todas as folhas com `ordem` anterior —
 *   o que reproduz a DRE padrão (Receita Líquida, Lucro Bruto, Resultado antes
 *   do IR, Lucro Líquido) sem precisar de fórmulas fixas por linha.
 */
export function calcularDre(linhas: LinhaDreBase[], itens: ItemClassificado[]): LinhaDreCalculada[] {
  const somaFolha: Record<string, number> = {}
  for (const it of itens) {
    const codigo = it.corrigido_para ?? it.linha_dre
    const v = it.tipo === 'debito' ? -Number(it.valor) : Number(it.valor)
    somaFolha[codigo] = (somaFolha[codigo] ?? 0) + v
  }

  const ordenadas = [...linhas].sort((a, b) => a.ordem - b.ordem)
  const folhas = ordenadas.filter((l) => isFolha(l.tipo))

  return ordenadas.map((l) => {
    if (l.tipo === 'grupo') {
      const valor = folhas
        .filter((x) => x.codigo.startsWith(l.codigo + '.'))
        .reduce((s, x) => s + (somaFolha[x.codigo] ?? 0), 0)
      return { ...l, valor }
    }
    if (l.tipo === 'resultado') {
      const valor = folhas
        .filter((x) => x.ordem < l.ordem)
        .reduce((s, x) => s + (somaFolha[x.codigo] ?? 0), 0)
      return { ...l, valor }
    }
    return { ...l, valor: somaFolha[l.codigo] ?? 0 }
  })
}
