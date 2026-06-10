import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type Transacao = {
  id: string
  descricao: string
  valor: number
  tipo: string
  data: string
}

export type ClassificacaoResult = {
  transacao_id: string
  linha_dre: string
  confianca: number
  justificativa: string
}

export async function classificarTransacoes(
  transacoes: Transacao[],
  linhasDre: { codigo: string; nome: string; tipo: string }[]
): Promise<ClassificacaoResult[]> {
  const linhasFormatadas = linhasDre
    .filter((l) => l.tipo !== 'grupo' && l.tipo !== 'resultado')
    .map((l) => `${l.codigo}: ${l.nome} (${l.tipo})`)
    .join('\n')

  const transacoesFormatadas = transacoes
    .map((t) => `ID: ${t.id} | Data: ${t.data} | Tipo: ${t.tipo} | Valor: R$ ${t.valor.toFixed(2)} | Descrição: ${t.descricao}`)
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: `Você é um especialista em contabilidade e classificação financeira para DRE (Demonstração do Resultado do Exercício).
Sua tarefa é classificar transações bancárias nas linhas corretas da DRE.
Responda SOMENTE com JSON válido, sem texto adicional.`,
    messages: [
      {
        role: 'user',
        content: `Classifique as transações abaixo nas linhas da DRE.

LINHAS DA DRE DISPONÍVEIS:
${linhasFormatadas}

TRANSAÇÕES PARA CLASSIFICAR:
${transacoesFormatadas}

Retorne um array JSON com o seguinte formato para cada transação:
[
  {
    "transacao_id": "uuid-da-transacao",
    "linha_dre": "codigo-da-linha",
    "confianca": 0.95,
    "justificativa": "breve justificativa"
  }
]

Regras:
- confianca deve ser entre 0 e 1
- linha_dre deve ser exatamente o código da linha (ex: "6.1")
- Classifique TODAS as transações fornecidas`,
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Resposta inesperada da Claude API')

  const jsonMatch = content.text.match(/\[[\s\S]*\]/)
  if (!jsonMatch) throw new Error('JSON não encontrado na resposta')

  return JSON.parse(jsonMatch[0]) as ClassificacaoResult[]
}
