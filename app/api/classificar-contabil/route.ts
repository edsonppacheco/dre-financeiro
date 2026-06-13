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
      .is('transferencia_id', null)
    if (!txs?.length) return NextResponse.json({ classificadas: 0, porRegra: 0, porHeuristica: 0, porIA: 0, pessoas: 0 })

    const { data: plano } = await supabase.from('plano_contas').select('id, codigo, nome, tipo')
    const idPorCodigo: Record<string, string> = {}
    for (const p of plano ?? []) idPorCodigo[p.codigo] = p.id

    const chaves = Array.from(new Set(txs.map((t) => extrairChave(t.descricao))))

    // Aprendizado direto do HISTÓRICO: aprende com lançamentos já atribuídos
    // (em qualquer conta), escolhendo o valor mais frequente por contraparte.
    const maisFrequente = (arr: string[]): string | null => {
      const c: Record<string, number> = {}
      for (const x of arr) c[x] = (c[x] ?? 0) + 1
      let melhor: string | null = null, n = 0
      for (const [k, v] of Object.entries(c)) if (v > n) { n = v; melhor = k }
      return melhor
    }
    const histConta: Record<string, string> = {}
    const histPessoa: Record<string, { cliente_id: string | null; fornecedor_id: string | null }> = {}
    {
      const { data: comConta } = await supabase
        .from('transacoes').select('descricao, conta_contabil_id').not('conta_contabil_id', 'is', null)
      const acc: Record<string, string[]> = {}
      for (const t of comConta ?? []) (acc[extrairChave(t.descricao)] ??= []).push(t.conta_contabil_id as string)
      for (const [k, v] of Object.entries(acc)) { const m = maisFrequente(v); if (m) histConta[k] = m }

      const { data: comPessoa } = await supabase
        .from('transacoes').select('descricao, cliente_id, fornecedor_id').or('cliente_id.not.is.null,fornecedor_id.not.is.null')
      const accC: Record<string, string[]> = {}, accF: Record<string, string[]> = {}
      for (const t of comPessoa ?? []) {
        const k = extrairChave(t.descricao)
        if (t.cliente_id) (accC[k] ??= []).push(t.cliente_id as string)
        if (t.fornecedor_id) (accF[k] ??= []).push(t.fornecedor_id as string)
      }
      for (const k of new Set([...Object.keys(accC), ...Object.keys(accF)])) {
        const c = accC[k] ? maisFrequente(accC[k]) : null
        const f = accF[k] ? maisFrequente(accF[k]) : null
        // cliente vence se for tão ou mais frequente que fornecedor
        histPessoa[k] = (accC[k]?.length ?? 0) >= (accF[k]?.length ?? 0) ? { cliente_id: c, fornecedor_id: null } : { cliente_id: null, fornecedor_id: f }
      }
    }

    // Regras aprendidas persistidas (complementam o histórico)
    const regras: Record<string, string> = {}
    try {
      const { data: rs } = await supabase.from('regras_classificacao').select('chave, conta_contabil_id').in('chave', chaves)
      for (const r of rs ?? []) regras[r.chave] = r.conta_contabil_id
    } catch { /* sem tabela */ }
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
      // conta contábil (só se ainda não tiver): histórico -> regra -> heurística -> IA
      if (!t.conta_contabil_id) {
        const doHist = histConta[chave]
        if (doHist) { setU(t.id, { conta_contabil_id: doHist }); porRegra++ }
        else if (regras[chave]) { setU(t.id, { conta_contabil_id: regras[chave] }); porRegra++ }
        else {
          const cod = heuristicaCodigo(t.descricao, t.tipo)
          if (cod && idPorCodigo[cod]) { setU(t.id, { conta_contabil_id: idPorCodigo[cod] }); porHeuristica++ }
          else paraIA.push({ id: t.id, descricao: t.descricao, valor: t.valor, tipo: t.tipo })
        }
      }
      // cliente/fornecedor por aprendizado (só se ainda não tiver nenhum): histórico -> regra
      if (!t.cliente_id && !t.fornecedor_id) {
        const rp = histPessoa[chave] ?? regrasPessoa[chave]
        if (rp?.cliente_id) { setU(t.id, { cliente_id: rp.cliente_id }); pessoas++ }
        else if (rp?.fornecedor_id) { setU(t.id, { fornecedor_id: rp.fornecedor_id }); pessoas++ }
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
