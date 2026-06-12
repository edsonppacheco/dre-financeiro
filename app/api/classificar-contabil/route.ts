import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { extrairChave, heuristicaCodigo } from '@/lib/classificador-contabil'
import { classificarContaContabilIA } from '@/lib/claude'

// POST { conta_id } — sugere a conta contábil dos lançamentos ainda sem classificação.
// Ordem: regra aprendida -> heurística -> IA. Não sobrescreve o que já tem conta.
export async function POST(req: NextRequest) {
  try {
    const { conta_id } = await req.json()
    if (!conta_id) return NextResponse.json({ error: 'conta_id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    const { data: txs } = await supabase
      .from('transacoes')
      .select('id, descricao, valor, tipo')
      .eq('conta_id', conta_id)
      .is('conta_contabil_id', null)
    if (!txs?.length) return NextResponse.json({ classificadas: 0, porRegra: 0, porHeuristica: 0, porIA: 0 })

    const { data: plano } = await supabase.from('plano_contas').select('id, codigo, nome, tipo')
    const idPorCodigo: Record<string, string> = {}
    for (const p of plano ?? []) idPorCodigo[p.codigo] = p.id

    // Regras aprendidas (chave -> conta_contabil_id)
    let regras: Record<string, string> = {}
    try {
      const chaves = Array.from(new Set(txs.map((t) => extrairChave(t.descricao))))
      const { data: rs } = await supabase.from('regras_classificacao').select('chave, conta_contabil_id').in('chave', chaves)
      for (const r of rs ?? []) regras[r.chave] = r.conta_contabil_id
    } catch { regras = {} }

    const updates: { id: string; conta_contabil_id: string }[] = []
    const paraIA: typeof txs = []
    let porRegra = 0, porHeuristica = 0

    for (const t of txs) {
      const chave = extrairChave(t.descricao)
      if (regras[chave]) { updates.push({ id: t.id, conta_contabil_id: regras[chave] }); porRegra++; continue }
      const cod = heuristicaCodigo(t.descricao, t.tipo)
      if (cod && idPorCodigo[cod]) { updates.push({ id: t.id, conta_contabil_id: idPorCodigo[cod] }); porHeuristica++; continue }
      paraIA.push(t)
    }

    // IA para o restante (em lotes)
    let porIA = 0
    for (let i = 0; i < paraIA.length; i += 25) {
      const lote = paraIA.slice(i, i + 25)
      const res = await classificarContaContabilIA(lote, plano ?? [])
      for (const r of res) {
        const id = idPorCodigo[r.codigo]
        if (id) { updates.push({ id: r.id, conta_contabil_id: id }); porIA++ }
      }
    }

    // Aplica as atualizações
    for (const u of updates) {
      await supabase.from('transacoes').update({ conta_contabil_id: u.conta_contabil_id }).eq('id', u.id)
    }

    return NextResponse.json({ classificadas: updates.length, porRegra, porHeuristica, porIA })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
