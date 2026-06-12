import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { nome, banco } = await req.json()
    if (!nome || !banco) return NextResponse.json({ error: 'nome e banco obrigatórios' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    // Retorna existente ou cria novo
    const { data: existing } = await supabase
      .from('contas')
      .select('id')
      .eq('nome', nome)
      .eq('banco', banco)
      .maybeSingle()

    if (existing) return NextResponse.json({ id: existing.id })

    const { data, error } = await supabase.from('contas').insert({ nome, banco }).select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ id: data.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function GET() {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase.from('contas').select('*').order('nome')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contas: data })
}
