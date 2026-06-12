import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CAMPOS = 'id, nome, cnpj, email, telefone, endereco, razao_social, created_at'
const EDITAVEIS = ['nome', 'cnpj', 'email', 'telefone', 'endereco', 'razao_social'] as const

// Remove caracteres que quebrariam o filtro .or() do PostgREST
const sanitize = (s: string) => s.replace(/[,()]/g, ' ').trim()

/**
 * Gera os handlers REST (GET/POST/PATCH/DELETE) para clientes ou fornecedores,
 * que têm o mesmo formato. A FK em transacoes é cliente_id / fornecedor_id.
 */
export function criarHandlers(tabela: 'clientes' | 'fornecedores') {
  const fk = tabela === 'clientes' ? 'cliente_id' : 'fornecedor_id'

  async function GET(req: NextRequest) {
    try {
      const supabase = createSupabaseAdminClient()
      const { searchParams } = new URL(req.url)
      const id = searchParams.get('id')

      // Detalhe: pessoa + suas transações
      if (id) {
        const { data: pessoa, error } = await supabase.from(tabela).select(CAMPOS).eq('id', id).single()
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        const { data: transacoes } = await supabase
          .from('transacoes')
          .select('id, data, descricao, valor, tipo, conta_id, contas(nome)')
          .eq(fk, id)
          .order('data', { ascending: false })
        return NextResponse.json({ pessoa, transacoes: transacoes ?? [] })
      }

      // Lista + busca
      const q = searchParams.get('q')
      let query = supabase.from(tabela).select(CAMPOS).order('nome')
      if (q && sanitize(q)) {
        const term = sanitize(q)
        query = query.or(`nome.ilike.%${term}%,cnpj.ilike.%${term}%,email.ilike.%${term}%,razao_social.ilike.%${term}%`)
      }
      const { data, error } = await query
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ pessoas: data ?? [] })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
    }
  }

  async function POST(req: NextRequest) {
    try {
      const body = await req.json()
      if (!body.nome?.trim()) return NextResponse.json({ error: 'nome obrigatório' }, { status: 400 })
      const row: Record<string, unknown> = {}
      for (const c of EDITAVEIS) row[c] = body[c]?.toString().trim() || (c === 'nome' ? undefined : null)
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase.from(tabela).insert(row).select(CAMPOS).single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ pessoa: data })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
    }
  }

  async function PATCH(req: NextRequest) {
    try {
      const body = await req.json()
      if (!body.id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
      const update: Record<string, unknown> = {}
      for (const c of EDITAVEIS) {
        if (body[c] !== undefined) {
          if (c === 'nome' && !body.nome.trim()) return NextResponse.json({ error: 'nome não pode ser vazio' }, { status: 400 })
          update[c] = body[c]?.toString().trim() || (c === 'nome' ? body.nome : null)
        }
      }
      if (!Object.keys(update).length) return NextResponse.json({ error: 'nada para atualizar' }, { status: 400 })
      const supabase = createSupabaseAdminClient()
      const { data, error } = await supabase.from(tabela).update(update).eq('id', body.id).select(CAMPOS).single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ pessoa: data })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
    }
  }

  async function DELETE(req: NextRequest) {
    try {
      const { searchParams } = new URL(req.url)
      const id = searchParams.get('id')
      if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })
      const supabase = createSupabaseAdminClient()
      // Transações ligadas ficam com a FK null (on delete set null)
      const { error } = await supabase.from(tabela).delete().eq('id', id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    } catch (err: unknown) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
    }
  }

  return { GET, POST, PATCH, DELETE }
}
