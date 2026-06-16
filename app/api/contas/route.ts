import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const TIPOS = ['corrente', 'cartao', 'emprestimo']

// Empresa BRL mais antiga — usada como default para contas criadas sem empresa_id
// explícito (mantém compatibilidade com fluxos antigos, ex: upload).
async function empresaDefault(supabase: ReturnType<typeof createSupabaseAdminClient>): Promise<string | null> {
  const { data } = await supabase.from('empresas').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle()
  return data?.id ?? null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const empresaId = searchParams.get('empresa_id')
  const supabase = createSupabaseAdminClient()
  let query = supabase
    .from('contas')
    .select('*, empresas(id, nome, moeda)')
    .order('tipo', { ascending: true })
    .order('nome', { ascending: true })
  if (empresaId) query = query.eq('empresa_id', empresaId)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contas: data })
}

export async function POST(req: NextRequest) {
  try {
    const { nome, banco, tipo, empresa_id } = await req.json()
    if (!nome || !banco) return NextResponse.json({ error: 'nome e banco obrigatórios' }, { status: 400 })
    const t = TIPOS.includes(tipo) ? tipo : 'corrente'

    const supabase = createSupabaseAdminClient()
    const empresaId = empresa_id || (await empresaDefault(supabase))

    // Upsert por nome+banco (mantém compatibilidade com a tela de upload)
    const { data: existing } = await supabase
      .from('contas')
      .select('id')
      .eq('nome', nome)
      .eq('banco', banco)
      .maybeSingle()
    if (existing) return NextResponse.json({ id: existing.id })

    const { data, error } = await supabase.from('contas').insert({ nome, banco, tipo: t, empresa_id: empresaId }).select('*, empresas(id, nome, moeda)').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ id: data.id, conta: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, nome, banco, tipo, empresa_id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (nome !== undefined) {
      if (!nome.trim()) return NextResponse.json({ error: 'nome não pode ser vazio' }, { status: 400 })
      update.nome = nome.trim()
    }
    if (banco !== undefined) update.banco = banco
    if (tipo !== undefined) {
      if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
      update.tipo = tipo
    }
    if (empresa_id !== undefined) update.empresa_id = empresa_id
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase.from('contas').update(update).eq('id', id).select('*, empresas(id, nome, moeda)').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ conta: data })
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
    // Bloqueia exclusão se houver lançamentos (evita apagar transações por cascata)
    const { count } = await supabase
      .from('transacoes')
      .select('id', { count: 'exact', head: true })
      .eq('conta_id', id)
    if (count && count > 0) {
      return NextResponse.json({ error: `Conta possui ${count} lançamento(s). Remova-os antes de excluir.` }, { status: 409 })
    }

    const { error } = await supabase.from('contas').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
