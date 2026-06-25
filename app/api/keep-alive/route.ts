import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// Keep-alive do Supabase: o plano gratuito pausa o projeto após 7 dias sem
// atividade. Acionado por um Vercel Cron diário (ver vercel.json), faz uma
// consulta mínima que toca o Postgres, mantendo o projeto ativo.
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('contas').select('id', { head: true, count: 'exact' }).limit(1)
    if (error) return NextResponse.json({ ok: false, erro: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, ts: new Date().toISOString() })
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, erro: err instanceof Error ? err.message : 'erro' }, { status: 500 })
  }
}
