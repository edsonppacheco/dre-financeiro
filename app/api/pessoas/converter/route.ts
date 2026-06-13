import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const CAMPOS = ['nome', 'cnpj', 'email', 'telefone', 'endereco', 'razao_social']

// POST { id, de: 'cliente' | 'fornecedor' } — move o cadastro para a outra
// tabela e repõe as transações vinculadas. Útil para corrigir erros de cadastro.
export async function POST(req: NextRequest) {
  try {
    const { id, de } = await req.json()
    if (!id || !['cliente', 'fornecedor'].includes(de)) {
      return NextResponse.json({ error: 'id e de (cliente|fornecedor) obrigatórios' }, { status: 400 })
    }
    const origem = de === 'cliente' ? 'clientes' : 'fornecedores'
    const destino = de === 'cliente' ? 'fornecedores' : 'clientes'
    const fkOrigem = de === 'cliente' ? 'cliente_id' : 'fornecedor_id'
    const fkDestino = de === 'cliente' ? 'fornecedor_id' : 'cliente_id'

    const supabase = createSupabaseAdminClient()

    const { data: pessoa, error: e1 } = await supabase.from(origem).select('*').eq('id', id).single()
    if (e1 || !pessoa) return NextResponse.json({ error: 'cadastro não encontrado' }, { status: 404 })

    const novo: Record<string, unknown> = {}
    for (const c of CAMPOS) novo[c] = pessoa[c]
    const { data: criado, error: e2 } = await supabase.from(destino).insert(novo).select('id').single()
    if (e2) return NextResponse.json({ error: e2.message }, { status: 500 })

    // Repõe transações: a FK de origem vira a FK de destino com o novo id
    await supabase.from('transacoes').update({ [fkDestino]: criado.id, [fkOrigem]: null }).eq(fkOrigem, id)

    // Remove o cadastro antigo (transações já foram repostas)
    await supabase.from(origem).delete().eq('id', id)

    return NextResponse.json({ id: criado.id, destino })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
