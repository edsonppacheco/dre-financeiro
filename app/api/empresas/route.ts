import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { registrarAtividade } from '@/lib/atividades'

const MOEDAS = ['BRL', 'USD']

export async function GET() {
  const supabase = createSupabaseAdminClient()
  const { data, error } = await supabase
    .from('empresas')
    .select('id, nome, moeda, pais, created_at')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ empresas: data })
}

export async function POST(req: NextRequest) {
  try {
    const { nome, moeda, pais } = await req.json()
    if (!nome?.trim()) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 })
    const m = MOEDAS.includes(moeda) ? moeda : 'BRL'

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('empresas')
      .insert({ nome: nome.trim(), moeda: m, pais: pais?.trim() || null })
      .select('id, nome, moeda, pais, created_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    await registrarAtividade(supabase, { acao: 'criar_empresa', entidade: 'empresa', entidade_id: data.id, descricao: `Empresa criada: "${data.nome}" (${data.moeda})` })
    return NextResponse.json({ empresa: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, nome, moeda, pais } = await req.json()
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (nome !== undefined) {
      if (!nome.trim()) return NextResponse.json({ error: 'nome não pode ser vazio' }, { status: 400 })
      update.nome = nome.trim()
    }
    if (moeda !== undefined) {
      if (!MOEDAS.includes(moeda)) return NextResponse.json({ error: 'moeda inválida' }, { status: 400 })
      update.moeda = moeda
    }
    if (pais !== undefined) update.pais = pais?.trim() || null
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase.from('empresas').update(update).eq('id', id).select('id, nome, moeda, pais, created_at').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ empresa: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const supabase = createSupabaseAdminClient()

    // Bloqueia exclusão se houver contas vinculadas (mesmo padrão de /api/contas)
    const { count } = await supabase.from('contas').select('id', { count: 'exact', head: true }).eq('empresa_id', id)
    if (count && count > 0) {
      return NextResponse.json({ error: `Empresa possui ${count} conta(s). Remova-as antes de excluir.` }, { status: 409 })
    }

    const { error } = await supabase.from('empresas').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
