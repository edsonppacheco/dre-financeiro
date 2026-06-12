// Classificação da conta contábil de um lançamento.
// Ordem de prioridade (aplicada na rota /api/classificar-contabil):
//   1) regra aprendida (contraparte -> conta), de correções anteriores do usuário
//   2) heurística por palavras-chave e formato (este arquivo)
//   3) IA (fallback, em lib/claude.ts)

const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

// Palavra-chave -> código do plano de contas padrão
const KEYWORDS: [RegExp, string][] = [
  [/\b(folha|salario|colaborador|funcionario|pro.?labore)\b/, '3.1'],
  [/\b(comiss)/, '3.2'],
  [/\b(marketing|google ads|\bads\b|meta|facebook|instagram|publicidade|trafego|midia)\b/, '3.3'],
  [/\b(jurid|advog|cartorio|contab|contador)\b/, '3.4'],
  [/\b(software|saas|hosting|servidor|\baws\b|cloud|dominio|sistema|tecnolog|assinatura digital|licenca)\b/, '3.5'],
  [/\b(energia|luz|enel|cemig|light|\bagua\b|sabesp|condominio|aluguel|internet|telefone|vivo|claro|\btim\b|\bgas\b|limpeza|material)\b/, '3.6'],
  [/\b(imposto|darf|\bdas\b|irpj|csll|\biss\b|inss|tributo|guia de recolhimento)\b/, '2'],
  [/\b(distribuic.*lucro|dividendo)\b/, '3.7'],
  [/\b(recebimento|receita|venda|faturamento|recebido)\b/, '1'],
]

const TERMOS_EMPRESA = /\b(ltda|me|s\/?a|eireli|servicos|tech|solutions|comercio|industria|cia|consultoria|corp|inc)\b/i

// Contraparte = parte antes de " - " (formato comum de extratos); senão a descrição toda
export function contraparte(descricao: string): string {
  return (descricao.includes(' - ') ? descricao.split(' - ')[0] : descricao).trim()
}

export function extrairChave(descricao: string): string {
  return norm(contraparte(descricao)).slice(0, 60)
}

/** Retorna o código do plano de contas sugerido, ou null se indeterminado. */
export function heuristicaCodigo(descricao: string, tipo: string): string | null {
  const t = norm(descricao)
  for (const [re, cod] of KEYWORDS) if (re.test(t)) return cod

  // Crédito sem palavra-chave: quase sempre receita
  if (tipo === 'credito') return '1'

  // Nome próprio (1-2 palavras, sem termos de empresa) tende a ser folha
  const cp = contraparte(descricao)
  const palavras = cp.split(/\s+/).filter(Boolean)
  if (!TERMOS_EMPRESA.test(cp) && palavras.length > 0 && palavras.length <= 2 && /^[A-ZÀ-Ý][a-zà-ý]+$/.test(palavras[0])) {
    return '3.1'
  }
  return null
}
