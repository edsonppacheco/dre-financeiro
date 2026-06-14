import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const TIPOS = ['receita', 'imposto', 'despesa', 'distribuicao', 'grupo']

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('plano_contas')
      .select('id, codigo, nome, tipo, pai_id, ordem')
      .order('ordem')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ contas: data ?? [] })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// Gera o próximo código (raiz: maior inteiro + 1; filho: pai.codigo + "." + (maior sufixo + 1))
function proximoCodigo(codigos: string[], paiCodigo: string | null): string {
  if (!paiCodigo) {
    const max = codigos.filter((c) => !c.includes('.')).reduce((m, c) => Math.max(m, parseInt(c, 10) || 0), 0)
    return String(max + 1)
  }
  const prefixo = paiCodigo + '.'
  const max = codigos
    .filter((c) => c.startsWith(prefixo) && c.slice(prefixo.length).match(/^\d+$/))
    .reduce((m, c) => Math.max(m, parseInt(c.slice(prefixo.length), 10) || 0), 0)
  return `${paiCodigo}.${max + 1}`
}

export async function POST(req: NextRequest) {
  try {
    const { nome, tipo, pai_id } = await req.json()
    if (!nome?.trim()) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 })
    if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data: existentes } = await supabase.from('plano_contas').select('codigo, pai_id, ordem')

    let paiCodigo: string | null = null
    if (pai_id) {
      const { data: pai } = await supabase.from('plano_contas').select('codigo').eq('id', pai_id).single()
      if (!pai) return NextResponse.json({ error: 'pai não encontrado' }, { status: 400 })
      paiCodigo = pai.codigo
    }

    const codigo = proximoCodigo((existentes ?? []).map((c) => c.codigo), paiCodigo)
    const ordem = ((existentes ?? []).reduce((m, c) => Math.max(m, c.ordem), 0)) + 1

    const { data, error } = await supabase
      .from('plano_contas')
      .insert({ nome: nome.trim(), tipo, pai_id: pai_id || null, codigo, ordem })
      .select('id, codigo, nome, tipo, pai_id, ordem')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ conta: data })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const { id, nome, tipo, ordem, pai_id } = await req.json()
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
    const update: Record<string, unknown> = {}
    if (nome !== undefined) {
      if (!nome.trim()) return NextResponse.json({ error: 'nome não pode ser vazio' }, { status: 400 })
      update.nome = nome.trim()
    }
    if (tipo !== undefined) {
      if (!TIPOS.includes(tipo)) return NextResponse.json({ error: 'tipo inválido' }, { status: 400 })
      update.tipo = tipo
    }
    if (ordem !== undefined) update.ordem = Number(ordem)
    if (pai_id !== undefined) update.pai_id = pai_id || null
    if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase
      .from('plano_contas')
      .update(update)
      .eq('id', id)
      .select('id, codigo, nome, tipo, pai_id, ordem')
      .single()
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
    // Filhos caem por cascade (pai_id on delete cascade); transações ficam com conta_contabil_id null
    const { error } = await supabase.from('plano_contas').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
