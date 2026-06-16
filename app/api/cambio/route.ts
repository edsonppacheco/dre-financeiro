import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterCambioMensal } from '@/lib/cambio'

// Histórico longo (vários anos) pode exigir buscar muitos meses na AwesomeAPI.
export const maxDuration = 120

// Processa em lotes pequenos para não disparar dezenas de requisições simultâneas
// à AwesomeAPI, mas ainda assim bem mais rápido que sequencial puro.
async function emLotes<T, R>(itens: T[], tamanho: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const resultados: R[] = []
  for (let i = 0; i < itens.length; i += tamanho) {
    const lote = itens.slice(i, i + tamanho)
    resultados.push(...(await Promise.all(lote.map(fn))))
  }
  return resultados
}

export async function GET() {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('cambio_mensal')
    .select('mes, moeda_origem, moeda_destino, taxa, fonte')
    .order('mes', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ cambios: data })
}

// POST — busca/atualiza o câmbio de todos os meses com transações (histórico
// completo) que ainda não estão em cambio_mensal, mais o mês corrente (sempre
// reforçado, pois cotações do mês em andamento mudam dia a dia).
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const ate = typeof body?.ate === 'string' ? body.ate : null

    const supabase = createSupabaseAdminClient()
    const datas = await selectAll<{ data: string }>(() => supabase.from('transacoes').select('data'))
    let meses = Array.from(new Set(datas.map((d) => d.data.slice(0, 7)))).sort()
    if (ate) meses = meses.filter((m) => m <= ate)

    const mesCorrente = new Date().toISOString().slice(0, 7)
    if (!meses.includes(mesCorrente)) meses.push(mesCorrente)

    const { data: existentes } = await supabase
      .from('cambio_mensal')
      .select('mes')
      .eq('moeda_origem', 'USD').eq('moeda_destino', 'BRL')
      .in('mes', meses)
    const jaTem = new Set((existentes ?? []).map((e) => e.mes as string))

    const aBuscar = meses.filter((m) => !jaTem.has(m) || m === mesCorrente)
    const resultados = await emLotes(aBuscar, 6, async (mes) => {
      try {
        await obterCambioMensal(mes, mes === mesCorrente)
        return { mes, ok: true as const }
      } catch (e) {
        return { mes, ok: false as const, erro: e instanceof Error ? e.message : 'erro desconhecido' }
      }
    })
    const atualizados = resultados.filter((r) => r.ok).map((r) => r.mes)
    const comErro = resultados.filter((r) => !r.ok).map((r) => ({ mes: r.mes, erro: (r as { erro: string }).erro }))

    return NextResponse.json({ atualizados, comErro, totalMeses: meses.length })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// PATCH — override manual de um mês específico (ex: corrigir uma cotação)
export async function PATCH(req: NextRequest) {
  try {
    const { mes, taxa } = await req.json()
    if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return NextResponse.json({ error: 'mes inválido (YYYY-MM)' }, { status: 400 })
    const t = Number(taxa)
    if (!t || t <= 0) return NextResponse.json({ error: 'taxa inválida' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { error } = await supabase
      .from('cambio_mensal')
      .upsert({ mes, moeda_origem: 'USD', moeda_destino: 'BRL', taxa: t, fonte: 'manual' }, { onConflict: 'mes,moeda_origem,moeda_destino' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
