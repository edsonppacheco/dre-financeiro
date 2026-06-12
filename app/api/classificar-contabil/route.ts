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
      .select('id, descricao, valor, tipo, conta_contabil_id, cliente_id, fornecedor_id')
      .eq('conta_id', conta_id)
    if (!txs?.length) return NextResponse.json({ classificadas: 0, porRegra: 0, porHeuristica: 0, porIA: 0, pessoas: 0 })

    const { data: plano } = await supabase.from('plano_contas').select('id, codigo, nome, tipo')
    const idPorCodigo: Record<string, string> = {}
    for (const p of plano ?? []) idPorCodigo[p.codigo] = p.id

    const chaves = Array.from(new Set(txs.map((t) => extrairChave(t.descricao))))

    // Regras aprendidas de conta contábil (chave -> conta_contabil_id)
    const regras: Record<string, string> = {}
    try {
      const { data: rs } = await supabase.from('regras_classificacao').select('chave, conta_contabil_id').in('chave', chaves)
      for (const r of rs ?? []) regras[r.chave] = r.conta_contabil_id
    } catch { /* sem tabela */ }

    // Regras aprendidas de pessoa (chave -> cliente/fornecedor)
    const regrasPessoa: Record<string, { cliente_id: string | null; fornecedor_id: string | null }> = {}
    try {
      const { data: rp } = await supabase.from('regras_pessoa').select('chave, cliente_id, fornecedor_id').in('chave', chaves)
      for (const r of rp ?? []) regrasPessoa[r.chave] = { cliente_id: r.cliente_id, fornecedor_id: r.fornecedor_id }
    } catch { /* sem tabela */ }

    // update por lançamento (mescla conta contábil + pessoa)
    const updateMap = new Map<string, Record<string, unknown>>()
    const setU = (id: string, campos: Record<string, unknown>) => updateMap.set(id, { ...(updateMap.get(id) ?? {}), ...campos })

    const paraIA: { id: string; descricao: string; valor: number; tipo: string }[] = []
    let porRegra = 0, porHeuristica = 0, pessoas = 0

    for (const t of txs) {
      const chave = extrairChave(t.descricao)
      // conta contábil (só se ainda não tiver)
      if (!t.conta_contabil_id) {
        if (regras[chave]) { setU(t.id, { conta_contabil_id: regras[chave] }); porRegra++ }
        else {
          const cod = heuristicaCodigo(t.descricao, t.tipo)
          if (cod && idPorCodigo[cod]) { setU(t.id, { conta_contabil_id: idPorCodigo[cod] }); porHeuristica++ }
          else paraIA.push({ id: t.id, descricao: t.descricao, valor: t.valor, tipo: t.tipo })
        }
      }
      // cliente/fornecedor por aprendizado (só se ainda não tiver nenhum)
      if (!t.cliente_id && !t.fornecedor_id && regrasPessoa[chave]) {
        const rp = regrasPessoa[chave]
        if (rp.cliente_id) { setU(t.id, { cliente_id: rp.cliente_id }); pessoas++ }
        else if (rp.fornecedor_id) { setU(t.id, { fornecedor_id: rp.fornecedor_id }); pessoas++ }
      }
    }

    // IA para a conta contábil restante (em lotes)
    let porIA = 0
    for (let i = 0; i < paraIA.length; i += 25) {
      const lote = paraIA.slice(i, i + 25)
      const res = await classificarContaContabilIA(lote, plano ?? [])
      for (const r of res) {
        const id = idPorCodigo[r.codigo]
        if (id) { setU(r.id, { conta_contabil_id: id }); porIA++ }
      }
    }

    // Aplica as atualizações
    for (const [id, campos] of updateMap) {
      await supabase.from('transacoes').update(campos).eq('id', id)
    }

    return NextResponse.json({ classificadas: porRegra + porHeuristica + porIA, porRegra, porHeuristica, porIA, pessoas })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
