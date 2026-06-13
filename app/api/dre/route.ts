import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calcularDrePlano, type PlanoLinha } from '@/lib/dre-plano'

const ultimoDiaMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()

    // Meses disponíveis a partir da DATA real das transações classificadas
    const { data: datas } = await supabase
      .from('transacoes')
      .select('data')
      .not('conta_contabil_id', 'is', null)
    const meses = Array.from(new Set((datas ?? []).map((d) => (d.data as string).slice(0, 7)))).sort().reverse()

    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') ?? meses[0] ?? null

    const { data: planoRaw } = await supabase
      .from('plano_contas')
      .select('id, codigo, nome, tipo, pai_id, ordem')
      .order('ordem')
    const plano = (planoRaw ?? []) as PlanoLinha[]

    if (!mes) {
      return NextResponse.json({ meses, mes: null, linhas: [], lucroLiquido: 0, totalTransacoes: 0 })
    }

    // Soma (com sinal) por conta contábil no mês, pela data da transação
    const { data: txs } = await supabase
      .from('transacoes')
      .select('valor, tipo, conta_contabil_id')
      .not('conta_contabil_id', 'is', null)
      .gte('data', `${mes}-01`)
      .lte('data', ultimoDiaMes(mes))

    const somaPorConta: Record<string, number> = {}
    for (const t of txs ?? []) {
      const v = t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
      somaPorConta[t.conta_contabil_id as string] = (somaPorConta[t.conta_contabil_id as string] ?? 0) + v
    }

    const { linhas, lucroLiquido } = calcularDrePlano(plano, somaPorConta)
    return NextResponse.json({ meses, mes, linhas, lucroLiquido, totalTransacoes: (txs ?? []).length })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
