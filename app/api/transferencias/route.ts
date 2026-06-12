import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('transferencias')
    .select('id, data, valor, descricao, conta_origem_id, conta_destino_id, origem:conta_origem_id(nome), destino:conta_destino_id(nome)')
    .order('data', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ transferencias: data ?? [] })
}

export async function POST(req: NextRequest) {
  try {
    const { conta_origem_id, conta_destino_id, data, valor, descricao } = await req.json()
    if (!conta_origem_id || !conta_destino_id || !data || !valor) {
      return NextResponse.json({ error: 'origem, destino, data e valor são obrigatórios' }, { status: 400 })
    }
    if (conta_origem_id === conta_destino_id) {
      return NextResponse.json({ error: 'origem e destino devem ser contas diferentes' }, { status: 400 })
    }
    if (Number(valor) <= 0) {
      return NextResponse.json({ error: 'valor deve ser positivo' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const { data: nova, error } = await supabase
      .from('transferencias')
      .insert({ conta_origem_id, conta_destino_id, data, valor: Number(valor), descricao: descricao || null })
      .select('id, data, valor, descricao, conta_origem_id, conta_destino_id')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ transferencia: nova })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('transferencias').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
