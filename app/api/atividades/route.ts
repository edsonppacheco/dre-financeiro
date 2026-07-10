import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// GET /api/atividades?limite=200&acao=upload — log cronológico (mais recente 1º)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limite = Math.min(Number(searchParams.get('limite')) || 200, 500)
    const acao = searchParams.get('acao')

    const supabase = createSupabaseAdminClient()
    let q = supabase
      .from('atividades')
      .select('id, created_at, acao, entidade, entidade_id, descricao, dados')
      .order('created_at', { ascending: false })
      .limit(limite)
    if (acao) q = q.eq('acao', acao)
    const { data, error } = await q
    if (error) {
      // Tabela ainda não migrada: trata como "log não ativado" (não é erro fatal).
      if (/atividades/.test(error.message) && /schema cache|does not exist|não existe/i.test(error.message)) {
        return NextResponse.json({ atividades: [], pendente: true })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ atividades: data ?? [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
