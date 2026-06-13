import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

// POST — transferência entre contas: cria DOIS lançamentos simultâneos
// (débito na origem, crédito no destino). Sem conta contábil, para não
// distorcer a DRE (transferência não é receita nem despesa).
export async function POST(req: NextRequest) {
  try {
    const { conta_origem_id, conta_destino_id, data, valor, descricao } = await req.json()
    if (!conta_origem_id || !conta_destino_id || !data || !valor) {
      return NextResponse.json({ error: 'origem, destino, data e valor são obrigatórios' }, { status: 400 })
    }
    if (conta_origem_id === conta_destino_id) {
      return NextResponse.json({ error: 'origem e destino devem ser contas diferentes' }, { status: 400 })
    }
    const v = Number(valor)
    if (isNaN(v) || v <= 0) return NextResponse.json({ error: 'valor deve ser positivo' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data: contas } = await supabase.from('contas').select('id, nome').in('id', [conta_origem_id, conta_destino_id])
    const nome = (id: string) => contas?.find((c) => c.id === id)?.nome ?? 'conta'

    // Registro da transferência (para histórico)
    const { data: transf, error: tErr } = await supabase
      .from('transferencias')
      .insert({ conta_origem_id, conta_destino_id, data, valor: v, descricao: descricao || null })
      .select('id')
      .single()
    if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

    // Dois lançamentos simultâneos, vinculados à transferência
    const base = { data, valor: v, manual: true, transferencia_id: transf.id }
    const { error: lErr } = await supabase.from('transacoes').insert([
      { ...base, conta_id: conta_origem_id, tipo: 'debito', descricao: descricao || `Transferência para ${nome(conta_destino_id)}` },
      { ...base, conta_id: conta_destino_id, tipo: 'credito', descricao: descricao || `Transferência de ${nome(conta_origem_id)}` },
    ])
    if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

    return NextResponse.json({ id: transf.id })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
