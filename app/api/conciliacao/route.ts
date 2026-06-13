import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

type Tx = { id: string; extrato_id: string; data: string; valor: number; tipo: string; descricao: string }

// GET /api/conciliacao?conta_id=... — detecta extratos com datas sobrepostas e,
// no período de overlap, identifica transações duplicadas. O extrato que termina
// mais tarde "prevalece" (o dia de corte do anterior pode estar incompleto):
// removemos as duplicatas do extrato anterior. Casos que não casam viram dúvidas.
export async function GET(req: NextRequest) {
  try {
    const contaId = new URL(req.url).searchParams.get('conta_id')
    if (!contaId) return NextResponse.json({ error: 'conta_id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data: txsRaw } = await supabase
      .from('transacoes')
      .select('id, extrato_id, data, valor, tipo, descricao')
      .eq('conta_id', contaId)
      .not('extrato_id', 'is', null)
      .order('data', { ascending: true })

    const txs = (txsRaw ?? []).map((t) => ({ ...t, valor: Number(t.valor) })) as Tx[]

    // Agrupa por extrato e calcula a faixa de datas
    const porExtrato = new Map<string, Tx[]>()
    for (const t of txs) { if (!porExtrato.has(t.extrato_id)) porExtrato.set(t.extrato_id, []); porExtrato.get(t.extrato_id)!.push(t) }
    const extratos = Array.from(porExtrato.entries()).map(([id, lista]) => ({
      id,
      inicio: lista.reduce((m, t) => (t.data < m ? t.data : m), lista[0].data),
      fim: lista.reduce((m, t) => (t.data > m ? t.data : m), lista[0].data),
      txs: lista,
    }))

    const fmtPer = (e: { inicio: string; fim: string }) => `${e.inicio} a ${e.fim}`
    const pares: {
      overlap: { inicio: string; fim: string }
      anterior: { id: string; periodo: string }
      prevalece: { id: string; periodo: string }
      duplicatas: { id: string; data: string; valor: number; tipo: string; descricao: string }[]
      ambiguos: { id: string; data: string; valor: number; tipo: string; descricao: string; motivo: string }[]
    }[] = []

    // Compara cada par de extratos
    for (let i = 0; i < extratos.length; i++) {
      for (let j = i + 1; j < extratos.length; j++) {
        const a = extratos[i], b = extratos[j]
        const ini = a.inicio > b.inicio ? a.inicio : b.inicio
        const fim = a.fim < b.fim ? a.fim : b.fim
        if (ini > fim) continue // sem sobreposição

        // prevalece o que termina mais tarde (dia de corte mais completo)
        const [prev, ant] = a.fim >= b.fim ? [a, b] : [b, a]

        const noOverlap = (t: Tx) => t.data >= ini && t.data <= fim
        const antTxs = ant.txs.filter(noOverlap)
        const prevTxs = prev.txs.filter(noOverlap)

        // multiset das chaves do extrato que prevalece
        const disponiveis = new Map<string, number>()
        const chave = (t: Tx) => `${t.data}|${t.valor.toFixed(2)}|${t.tipo}`
        for (const t of prevTxs) disponiveis.set(chave(t), (disponiveis.get(chave(t)) ?? 0) + 1)

        const duplicatas: typeof pares[number]['duplicatas'] = []
        const ambiguos: typeof pares[number]['ambiguos'] = []
        for (const t of antTxs) {
          const k = chave(t)
          const n = disponiveis.get(k) ?? 0
          if (n > 0) { disponiveis.set(k, n - 1); duplicatas.push({ id: t.id, data: t.data, valor: t.valor, tipo: t.tipo, descricao: t.descricao }) }
          else ambiguos.push({ id: t.id, data: t.data, valor: t.valor, tipo: t.tipo, descricao: t.descricao, motivo: 'Sem correspondência no extrato mais recente' })
        }

        if (duplicatas.length || ambiguos.length) {
          pares.push({
            overlap: { inicio: ini, fim },
            anterior: { id: ant.id, periodo: fmtPer(ant) },
            prevalece: { id: prev.id, periodo: fmtPer(prev) },
            duplicatas, ambiguos,
          })
        }
      }
    }

    return NextResponse.json({ pares, totalDuplicatas: pares.reduce((s, p) => s + p.duplicatas.length, 0) })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}

// POST { remover: string[] } — remove as transações duplicadas confirmadas
export async function POST(req: NextRequest) {
  try {
    const { remover } = await req.json()
    if (!Array.isArray(remover) || remover.length === 0) {
      return NextResponse.json({ error: 'lista "remover" obrigatória' }, { status: 400 })
    }
    const supabase = createSupabaseAdminClient()
    const { error } = await supabase.from('transacoes').delete().in('id', remover)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ removidas: remover.length })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
