import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calcularDre, type ItemClassificado, type LinhaDreBase } from '@/lib/dre'

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()

    // Meses disponíveis (distintos), mais recente primeiro
    const { data: extratos } = await supabase
      .from('extratos')
      .select('mes_referencia')
      .order('mes_referencia', { ascending: false })

    const meses = Array.from(
      new Set((extratos ?? []).map((e) => (e.mes_referencia as string).slice(0, 7)))
    )

    // Mês solicitado, ou o mais recente disponível
    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') ?? meses[0] ?? null

    const { data: linhasRaw } = await supabase
      .from('linhas_dre')
      .select('codigo, nome, tipo, ordem')
      .order('ordem')
    const linhas = (linhasRaw ?? []) as LinhaDreBase[]

    if (!mes) {
      return NextResponse.json({ meses, mes: null, linhas: [], totalTransacoes: 0 })
    }

    const { data: agregado } = await supabase
      .from('classificacoes')
      .select('linha_dre, corrigido_para, transacoes!inner(valor, tipo, extratos!inner(mes_referencia))')
      .eq('transacoes.extratos.mes_referencia', `${mes}-01`)

    const itens: ItemClassificado[] = (agregado ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => {
        const tx = c.transacoes
        if (!tx) return null
        return {
          linha_dre: c.linha_dre,
          corrigido_para: c.corrigido_para,
          valor: tx.valor,
          tipo: tx.tipo,
        }
      })
      .filter((x): x is ItemClassificado => x !== null)

    const calculadas = calcularDre(linhas, itens)

    return NextResponse.json({ meses, mes, linhas: calculadas, totalTransacoes: itens.length })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
