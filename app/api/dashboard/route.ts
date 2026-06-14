import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'

const round = (x: number) => Math.round(x * 100) / 100
const mesStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${NOMES[Number(mm) - 1]}/${a}` }

export async function GET() {
  try {
    const supabase = createSupabaseAdminClient()

    const [{ data: contasRaw }, { data: planoRaw }, { data: txAll }] = await Promise.all([
      supabase.from('contas').select('id, nome, tipo, saldo_inicial'),
      supabase.from('plano_contas').select('id, tipo'),
      supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id'),
    ])

    const tipoContaContabil: Record<string, string> = {}
    for (const p of planoRaw ?? []) tipoContaContabil[p.id] = p.tipo

    // Saldos por conta
    const saldo: Record<string, number> = {}
    for (const c of contasRaw ?? []) saldo[c.id] = Number(c.saldo_inicial ?? 0)
    let ultima: string | null = null
    for (const t of txAll ?? []) {
      saldo[t.conta_id as string] = (saldo[t.conta_id as string] ?? 0) + (t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor))
      const d = t.data as string
      if (!ultima || d > ultima) ultima = d
    }
    const contas = (contasRaw ?? []).map((c) => ({ nome: c.nome, tipo: c.tipo, saldo: round(saldo[c.id] ?? 0) }))
    const saldoTotal = round(contas.filter((c) => c.tipo === 'corrente').reduce((s, c) => s + c.saldo, 0))
    const dividasLongoPrazo = round(contas.filter((c) => c.tipo === 'emprestimo').reduce((s, c) => s + c.saldo, 0))
    const saldoCartoes = round(contas.filter((c) => c.tipo === 'cartao').reduce((s, c) => s + c.saldo, 0))

    // Receita/Despesa por mês — ancorado no mês mais recente COM dados
    // (mais útil que o mês corrente quando o extrato é histórico)
    const ref = ultima ? new Date(Number(ultima.slice(0, 4)), Number(ultima.slice(5, 7)) - 1, 1) : new Date()
    const esteMes = mesStr(ref)
    const mesPassado = mesStr(new Date(ref.getFullYear(), ref.getMonth() - 1, 1))
    const mesAnterior = mesStr(new Date(ref.getFullYear(), ref.getMonth() - 2, 1))

    const acumMes: Record<string, { receita: number; despesa: number }> = {}
    for (const m of [esteMes, mesPassado, mesAnterior]) acumMes[m] = { receita: 0, despesa: 0 }
    for (const t of txAll ?? []) {
      const m = (t.data as string).slice(0, 7)
      if (!acumMes[m]) continue
      const tc = t.conta_contabil_id ? tipoContaContabil[t.conta_contabil_id as string] : null
      const v = Number(t.valor)
      if (tc === 'receita') acumMes[m].receita += v
      else if (tc === 'despesa' || tc === 'imposto') acumMes[m].despesa += v
    }
    const mes = (m: string) => ({ label: rotuloMes(m), receita: round(acumMes[m].receita), despesa: round(acumMes[m].despesa) })

    return NextResponse.json({
      ultimaAtualizacao: ultima,
      contas, saldoTotal, dividasLongoPrazo, saldoCartoes,
      esteMes: mes(esteMes), mesPassado: mes(mesPassado), mesAnterior: mes(mesAnterior),
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
