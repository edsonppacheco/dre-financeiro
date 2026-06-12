import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// GET — lista classificações com a transação e contexto (conta/mês), além das linhas DRE
export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()

    const { data: classificacoes, error } = await supabase
      .from('classificacoes')
      .select(
        `id, linha_dre, confianca, revisado, corrigido_para,
         transacoes!inner (
           id, data, descricao, valor, tipo, extrato_id,
           extratos!inner ( mes_referencia, contas ( nome, banco ) )
         )`
      )
      .order('confianca', { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    const { data: linhas } = await supabase
      .from('linhas_dre')
      .select('codigo, nome, tipo')
      .order('ordem')

    // Achata o formato para o cliente
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const itens = (classificacoes ?? []).map((c: any) => {
      const t = c.transacoes
      const e = t?.extratos
      const conta = e?.contas
      return {
        id: c.id,
        linha_dre: c.linha_dre,
        confianca: c.confianca,
        revisado: c.revisado,
        corrigido_para: c.corrigido_para,
        transacao_id: t?.id,
        data: t?.data,
        descricao: t?.descricao,
        valor: t?.valor,
        tipo: t?.tipo,
        mes_referencia: e?.mes_referencia,
        conta_nome: conta?.nome ?? null,
        conta_banco: conta?.banco ?? null,
      }
    })

    return NextResponse.json({ itens, linhas: linhas ?? [] })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// PATCH — atualiza uma classificação (correção e/ou marcação de revisado)
export async function PATCH(req: NextRequest) {
  try {
    const { id, corrigido_para, revisado } = await req.json()
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

    const update: Record<string, unknown> = {}
    if (corrigido_para !== undefined) update.corrigido_para = corrigido_para || null
    if (revisado !== undefined) update.revisado = revisado
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('classificacoes')
      .update(update)
      .eq('id', id)
      .select('id, linha_dre, confianca, revisado, corrigido_para')
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ classificacao: data })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
