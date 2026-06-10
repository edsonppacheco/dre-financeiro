import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { classificarTransacoes } from '@/lib/claude'

export async function POST(req: NextRequest) {
  try {
    const { extrato_id } = await req.json()
    if (!extrato_id) return NextResponse.json({ error: 'extrato_id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    // Busca transações sem classificação
    const { data: transacoes, error: txErr } = await supabase
      .from('transacoes')
      .select('id, descricao, valor, tipo, data, classificacoes(id)')
      .eq('extrato_id', extrato_id)

    if (txErr) return NextResponse.json({ error: txErr.message }, { status: 500 })
    if (!transacoes?.length) return NextResponse.json({ classificadas: 0 })

    const semClassificacao = transacoes.filter((t) => !t.classificacoes?.length)
    if (!semClassificacao.length) return NextResponse.json({ classificadas: 0, message: 'Já classificadas' })

    // Busca linhas DRE
    const { data: linhas } = await supabase.from('linhas_dre').select('codigo, nome, tipo').order('ordem')
    if (!linhas?.length) return NextResponse.json({ error: 'Nenhuma linha DRE cadastrada' }, { status: 400 })

    // Processa em lotes de 20 para não exceder tokens
    const BATCH_SIZE = 20
    let totalClassificadas = 0

    for (let i = 0; i < semClassificacao.length; i += BATCH_SIZE) {
      const lote = semClassificacao.slice(i, i + BATCH_SIZE)
      const resultados = await classificarTransacoes(lote, linhas)

      if (resultados.length > 0) {
        const { error: insertErr } = await supabase.from('classificacoes').insert(
          resultados.map((r) => ({
            transacao_id: r.transacao_id,
            linha_dre: r.linha_dre,
            confianca: r.confianca,
          }))
        )
        if (insertErr) throw new Error(insertErr.message)
        totalClassificadas += resultados.length
      }
    }

    return NextResponse.json({ classificadas: totalClassificadas })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
