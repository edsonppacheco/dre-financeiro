import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// Lista os documentos (extratos) já enviados, com conta, período, status e nº de transações.
export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('extratos')
      .select('id, mes_referencia, arquivo_url, status, created_at, contas(nome, banco, tipo), transacoes(count)')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const documentos = (data ?? []).map((e: any) => ({
      id: e.id,
      mes_referencia: e.mes_referencia,
      arquivo_url: e.arquivo_url,
      status: e.status,
      created_at: e.created_at,
      conta_nome: e.contas?.nome ?? null,
      conta_banco: e.contas?.banco ?? null,
      conta_tipo: e.contas?.tipo ?? null,
      transacoes: e.transacoes?.[0]?.count ?? 0,
    }))
    return NextResponse.json({ documentos })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
