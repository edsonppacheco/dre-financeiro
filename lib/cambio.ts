import { createSupabaseAdminClient } from './supabase'
import type { Moeda } from './formato'

const ultimoDiaDoMes = (ano: number, mes: number) => new Date(ano, mes, 0).getDate()

type AwesomeEntry = { bid: string; timestamp: string }

// Busca a série diária da AwesomeAPI (USD-BRL) para o mês informado e calcula a
// média do 'bid' (cotação de compra). N=40 é generoso o bastante para cobrir o
// mês inteiro mesmo havendo mais de uma cotação no mesmo dia; entradas fora do
// mês (spillover do dia anterior ao start_date) são descartadas pela data real
// derivada do timestamp.
async function buscarMediaAwesomeAPI(mes: string): Promise<number> {
  const [ano, mm] = mes.split('-').map(Number)
  const ultimoDia = ultimoDiaDoMes(ano, mm)
  const start = `${ano}${String(mm).padStart(2, '0')}01`
  const end = `${ano}${String(mm).padStart(2, '0')}${String(ultimoDia).padStart(2, '0')}`
  const url = `https://economia.awesomeapi.com.br/json/daily/USD-BRL/40?start_date=${start}&end_date=${end}`

  const res = await fetch(url)
  if (!res.ok) throw new Error(`AwesomeAPI respondeu ${res.status} para ${mes}`)
  const dados = (await res.json()) as AwesomeEntry[]
  if (!Array.isArray(dados) || !dados.length) throw new Error(`Sem cotações retornadas para ${mes}`)

  const doMes = dados.filter((d) => new Date(Number(d.timestamp) * 1000).toISOString().slice(0, 7) === mes)
  if (!doMes.length) throw new Error(`Nenhuma cotação dentro do mês ${mes}`)

  const soma = doMes.reduce((s, d) => s + Number(d.bid), 0)
  return Math.round((soma / doMes.length) * 1e6) / 1e6 // 6 casas decimais
}

/**
 * Retorna a taxa média mensal (1 USD = taxa BRL) do mês informado. Busca e
 * persiste em cambio_mensal na primeira vez; meses já gravados são reaproveitados
 * (a menos que forcar=true — usado para atualizar o mês corrente, ainda incompleto).
 */
export async function obterCambioMensal(mes: string, forcar = false): Promise<number> {
  const supabase = createSupabaseAdminClient()
  if (!forcar) {
    const { data } = await supabase
      .from('cambio_mensal')
      .select('taxa')
      .eq('mes', mes).eq('moeda_origem', 'USD').eq('moeda_destino', 'BRL')
      .maybeSingle()
    if (data) return Number(data.taxa)
  }

  const taxa = await buscarMediaAwesomeAPI(mes)
  await supabase
    .from('cambio_mensal')
    .upsert({ mes, moeda_origem: 'USD', moeda_destino: 'BRL', taxa, fonte: 'awesomeapi' }, { onConflict: 'mes,moeda_origem,moeda_destino' })
  return taxa
}

/**
 * Carrega as taxas de vários meses de uma vez (poucas idas ao banco/API),
 * buscando da AwesomeAPI as que ainda não existem. Meses sem cotação disponível
 * (ex: período futuro) são simplesmente omitidos do mapa retornado.
 */
// buscarFaltantes: quando true, busca na AwesomeAPI os meses ausentes (use só em
// rotas com tempo folgado, como /api/cambio). As rotas de leitura (dashboard/DRE)
// passam false para NÃO bloquear o request buscando dezenas de meses (o que
// estourava o timeout serverless e deixava o câmbio sem persistir) — elas leem o
// que já está no banco e avisam o usuário se faltar, deixando a carga para o botão.
export async function obterTaxasMensais(meses: string[], buscarFaltantes = true): Promise<Record<string, number>> {
  const unicos = Array.from(new Set(meses))
  if (!unicos.length) return {}
  const supabase = createSupabaseAdminClient()
  const { data: existentes } = await supabase
    .from('cambio_mensal')
    .select('mes, taxa')
    .eq('moeda_origem', 'USD').eq('moeda_destino', 'BRL')
    .in('mes', unicos)

  const mapa: Record<string, number> = {}
  for (const e of existentes ?? []) mapa[e.mes as string] = Number(e.taxa)

  if (buscarFaltantes) {
    const faltantes = unicos.filter((m) => mapa[m] === undefined)
    for (const mes of faltantes) {
      try { mapa[mes] = await obterCambioMensal(mes) } catch { /* mês sem cotação (ex: futuro); segue sem ele */ }
    }
  }
  return mapa
}

/**
 * Resolve a taxa do mês pedido; se faltar (ex: mês corrente ainda não buscado,
 * ou fim de período no futuro), usa a do mês disponível mais próximo — preferindo
 * o mais recente que seja <= mes (a cotação "vigente" naquele ponto); se não
 * houver nenhum anterior, usa o mais antigo disponível. Evita o erro grave de
 * devolver o valor sem converter (que misturaria BRL e USD como 1:1).
 */
export function resolverTaxa(mes: string, taxas: Record<string, number>): number | null {
  const exata = taxas[mes]
  if (exata != null) return exata
  const meses = Object.keys(taxas).sort()
  if (!meses.length) return null
  const anteriores = meses.filter((m) => m <= mes)
  return anteriores.length ? taxas[anteriores[anteriores.length - 1]] : taxas[meses[0]]
}

/** Conversão síncrona usando um mapa de taxas já carregado (mes -> taxa USD→BRL). */
export function converterComTaxas(valor: number, de: Moeda, para: Moeda, mes: string, taxas: Record<string, number>): number {
  if (de === para) return valor
  const taxa = resolverTaxa(mes, taxas)
  if (!taxa) return valor // nenhuma taxa disponível em todo o mapa: não há como converter
  const v = de === 'USD' ? valor * taxa : valor / taxa
  return Math.round(v * 100) / 100
}

/**
 * Retorna a ÚLTIMA cotação disponível (mês mais recente com taxa registrada em
 * cambio_mensal), independente dos meses envolvidos na visão. É a taxa usada nas
 * visões consolidadas em qualquer moeda — assim Painel, DRE, Distribuição e
 * Planejamento convertem tudo pela mesma cotação (a mais recente) e batem entre si.
 * Não busca na AwesomeAPI dentro do request (só lê do banco); null se não houver nenhuma.
 */
export async function obterUltimaTaxa(): Promise<number | null> {
  const supabase = createSupabaseAdminClient()
  const { data } = await supabase
    .from('cambio_mensal')
    .select('taxa, mes')
    .eq('moeda_origem', 'USD').eq('moeda_destino', 'BRL')
    .order('mes', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data ? Number(data.taxa) : null
}

/** Conversão síncrona usando uma única taxa (USD→BRL). Sem taxa, devolve o valor original. */
export function converterComUltima(valor: number, de: Moeda, para: Moeda, taxa: number | null): number {
  if (de === para || !taxa) return valor
  const v = de === 'USD' ? valor * taxa : valor / taxa
  return Math.round(v * 100) / 100
}

/** Conversão pontual (busca/persiste a taxa do mês se necessário). Use obterTaxasMensais + converterComTaxas para lotes. */
export async function converter(valor: number, de: Moeda, para: Moeda, mes: string): Promise<number> {
  if (de === para) return valor
  const taxa = await obterCambioMensal(mes)
  const v = de === 'USD' ? valor * taxa : valor / taxa
  return Math.round(v * 100) / 100
}
