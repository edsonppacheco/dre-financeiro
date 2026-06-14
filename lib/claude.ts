import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

export type ExtratoExtraido = {
  saldo_inicial: number
  transacoes: { data: string; descricao: string; valor: number; tipo: 'credito' | 'debito' }[]
  saldos_dia: { data: string; saldo: number }[]
}

/**
 * Extrai estrutura de um extrato bancário (texto de PDF) usando a IA.
 * Os sinais (crédito/débito) são um palpite — depois são reconstruídos de forma
 * determinística pelo solver (lib/extrato-solver) usando os saldos diários como
 * gabarito.
 */
export async function extrairExtratoPDF(texto: string): Promise<ExtratoExtraido> {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8000,
    system: 'Você extrai transações de extratos bancários brasileiros com precisão. Responda SOMENTE com JSON válido, sem texto adicional.',
    messages: [
      {
        role: 'user',
        content: `Extraia as transações deste extrato bancário.

REGRAS:
- A linha "Saldo em DATA (início) R$ X" (ou equivalente) é o saldo_inicial; NÃO é transação.
- Cada transação costuma ter um nome/contraparte e uma categoria + valor. Use descricao = "nome - categoria" quando houver os dois.
- Linhas soltas de "SALDO DO DIA" / saldo acumulado ao fim de cada data vão em saldos_dia; NÃO são transações.
- Capture TODOS os valores e TODOS os saldos de fim de dia, com precisão de centavos.
- O tipo (credito/debito) é só um palpite inicial — capriche nos valores e datas.

Retorne JSON:
{"saldo_inicial":<numero>,"transacoes":[{"data":"YYYY-MM-DD","descricao":"...","valor":<numero positivo>,"tipo":"credito|debito"}],"saldos_dia":[{"data":"YYYY-MM-DD","saldo":<numero>}]}

TEXTO DO EXTRATO:
${texto.slice(0, 80000)}`,
      },
    ],
  })

  const content = response.content[0]
  if (content.type !== 'text') throw new Error('Resposta inesperada da Claude API')
  if (response.stop_reason === 'max_tokens') {
    throw new Error('Extrato muito grande para uma única extração. Divida o arquivo em períodos menores (ex: por semestre) e reenvie.')
  }
  const match = content.text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('JSON não encontrado na resposta')
  const parsed = JSON.parse(match[0]) as ExtratoExtraido
  parsed.saldo_inicial = Number(parsed.saldo_inicial) || 0
  parsed.transacoes = (parsed.transacoes ?? []).map((t) => ({ ...t, valor: Math.abs(Number(t.valor)) }))
  parsed.saldos_dia = (parsed.saldos_dia ?? []).map((s) => ({ ...s, saldo: Number(s.saldo) }))
  return parsed
}

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

/**
 * Fallback de IA para classificar lançamentos no plano de contas contábeis
 * (usado só para os que regras + heurística não resolveram).
 * Retorna [{ id, codigo }] com o código do plano de contas.
 */
export async function classificarContaContabilIA(
  itens: { id: string; descricao: string; valor: number; tipo: string }[],
  plano: { codigo: string; nome: string; tipo: string }[]
): Promise<{ id: string; codigo: string }[]> {
  if (itens.length === 0) return []
  const planoFmt = plano
    .filter((p) => p.tipo !== 'grupo')
    .map((p) => `${p.codigo}: ${p.nome} (${p.tipo})`)
    .join('\n')
  const itensFmt = itens
    .map((i) => `ID: ${i.id} | ${i.tipo} | R$ ${i.valor.toFixed(2)} | ${i.descricao}`)
    .join('\n')

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: 'Você classifica lançamentos financeiros no plano de contas contábil de uma empresa. Responda SOMENTE com JSON válido.',
    messages: [
      {
        role: 'user',
        content: `Classifique cada lançamento na conta contábil mais adequada.

PLANO DE CONTAS:
${planoFmt}

LANÇAMENTOS:
${itensFmt}

Retorne um array JSON: [{"id":"<id>","codigo":"<codigo do plano>"}]
- credito normalmente é Receitas; pagamentos a pessoas físicas tendem a Folha de pagamento; contas de consumo (energia, água, condomínio) são Despesas gerais.
- Classifique TODOS os lançamentos.`,
      },
    ],
  })
  const content = response.content[0]
  if (content.type !== 'text') return []
  const match = content.text.match(/\[[\s\S]*\]/)
  if (!match) return []
  return JSON.parse(match[0]) as { id: string; codigo: string }[]
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
