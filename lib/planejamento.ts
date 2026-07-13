// Helpers compartilhados pelas rotas de planejamento (receitas, despesas,
// dashboard). Centraliza o escopo por empresa/moeda e a conversão de câmbio,
// reproduzindo a mesma semântica de app/api/dashboard/route.ts.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Moeda } from './formato'
import { converterComUltima } from './cambio'

export type Status = 'pago' | 'parcial' | 'a_vencer' | 'atrasado'

export type Escopo = {
  // ids das contas bancárias dentro das empresas selecionadas (para filtrar transações)
  contaIds: Set<string>
  moedaPorConta: Record<string, Moeda>
  // moeda de cada empresa (para converter os valores previstos, que são por empresa)
  moedaEmpresa: Record<string, Moeda>
  // ids de empresa efetivamente no escopo (vazio no input = todas)
  empresaIds: string[]
  combinada: boolean
  // moeda final da visão
  moeda: Moeda
}

/**
 * Monta o escopo de empresa/moeda: quais contas bancárias entram (para o
 * realizado) e qual a moeda de cada empresa (para o previsto). Quando há mais
 * de uma moeda entre as empresas selecionadas, a visão é "combinada" e os
 * valores são convertidos para `moedaParam`.
 */
export async function montarEscopo(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  empresaIds: string[],
  moedaParam: Moeda
): Promise<Escopo> {
  const [{ data: contasRaw }, { data: empresasRaw }] = await Promise.all([
    supabase.from('contas').select('id, empresa_id'),
    supabase.from('empresas').select('id, moeda'),
  ])

  const moedaEmpresa: Record<string, Moeda> = {}
  for (const e of empresasRaw ?? []) moedaEmpresa[e.id as string] = (e.moeda as Moeda) ?? 'BRL'

  const escopo = empresaIds.length ? empresaIds : (empresasRaw ?? []).map((e) => e.id as string)
  const escopoSet = new Set(escopo)

  const contasFiltradas = (contasRaw ?? []).filter((c) => escopoSet.has(c.empresa_id ?? ''))
  const contaIds = new Set(contasFiltradas.map((c) => c.id as string))
  const moedaPorConta: Record<string, Moeda> = {}
  for (const c of contasFiltradas) moedaPorConta[c.id as string] = moedaEmpresa[c.empresa_id ?? ''] ?? 'BRL'

  const moedasEmUso = new Set(escopo.map((id) => moedaEmpresa[id] ?? 'BRL'))
  const combinada = moedasEmUso.size > 1
  const moeda: Moeda = combinada ? moedaParam : ((moedasEmUso.values().next().value as Moeda) ?? 'BRL')

  return { contaIds, moedaPorConta, moedaEmpresa, empresaIds: escopo, combinada, moeda }
}

/**
 * Cria a função de conversão a partir da última cotação disponível (taxa única).
 * Fora da visão combinada, é identidade (não converte). Sinaliza
 * `cambioIndisponivel` quando é combinada mas não há taxa. O `mes` é ignorado
 * (mantido na assinatura por compatibilidade): a conversão consolidada usa
 * sempre a cotação mais recente.
 */
export function criarConversor(escopo: Escopo, taxa: number | null) {
  const cambioIndisponivel = escopo.combinada && taxa == null
  const conv = (valor: number, de: Moeda, _mes?: string) =>
    escopo.combinada ? converterComUltima(valor, de, escopo.moeda, taxa) : valor
  return { conv, cambioIndisponivel }
}

export const round = (x: number) => Math.round(x * 100) / 100
export const hojeISO = () => new Date().toISOString().slice(0, 10)
export const mesDe = (dataISO: string) => dataISO.slice(0, 7)

/**
 * Atribuição "waterfall" do realizado de um cliente às previsões do mesmo mês:
 * ordenadas por data prevista, cada linha recebe pago até seu valor previsto e o
 * excedente escorre para a próxima; a última recebe o resto (pode passar do
 * previsto). Recebe as linhas de UM mês e o total realizado no mês, devolve o
 * pago por id de linha.
 */
export function distribuirWaterfall(
  linhas: { id: string; valor_previsto: number }[],
  realizadoMes: number
): Record<string, number> {
  const ordenadas = [...linhas]
  const pago: Record<string, number> = {}
  let restante = realizadoMes
  for (let i = 0; i < ordenadas.length; i++) {
    const l = ordenadas[i]
    const ehUltima = i === ordenadas.length - 1
    const aloca = ehUltima ? Math.max(restante, 0) : Math.min(restante, l.valor_previsto)
    pago[l.id] = round(Math.max(aloca, 0))
    restante = round(restante - pago[l.id])
  }
  return pago
}

/** Deriva o status de uma linha de receita prevista. */
export function statusReceita(previsto: number, pago: number, dataPrevista: string, hoje: string): Status {
  if (pago >= previsto && previsto > 0) return 'pago'
  if (pago > 0 && pago < previsto) return dataPrevista < hoje ? 'atrasado' : 'parcial'
  // pago == 0 (ou previsto 0)
  return dataPrevista < hoje && previsto > 0 ? 'atrasado' : 'a_vencer'
}
