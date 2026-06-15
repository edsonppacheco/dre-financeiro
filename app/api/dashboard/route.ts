import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'

const round = (x: number) => Math.round(x * 100) / 100
const mesStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${NOMES[Number(mm) - 1]}/${a.slice(2)}` }

type RD = { receita: number; despesa: number }

export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const visao = new URL(req.url).searchParams.get('visao') ?? 'mes'

    const [{ data: contasRaw }, { data: planoRaw }, txAll] = await Promise.all([
      supabase.from('contas').select('id, nome, tipo, saldo_inicial'),
      supabase.from('plano_contas').select('id, tipo'),
      selectAll<{ conta_id: string; data: string; valor: number; tipo: string; conta_contabil_id: string | null }>(
        () => supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id')
      ),
    ])

    const tipoCC: Record<string, string> = {}
    for (const p of planoRaw ?? []) tipoCC[p.id] = p.tipo

    // Saldos por conta + última atualização + mapa mensal de receita/despesa
    const saldo: Record<string, number> = {}
    for (const c of contasRaw ?? []) saldo[c.id] = Number(c.saldo_inicial ?? 0)
    let ultima: string | null = null
    const porMes: Record<string, RD> = {}
    for (const t of txAll ?? []) {
      const v = Number(t.valor)
      saldo[t.conta_id as string] = (saldo[t.conta_id as string] ?? 0) + (t.tipo === 'credito' ? v : -v)
      const d = t.data as string
      if (!ultima || d > ultima) ultima = d
      const tc = t.conta_contabil_id ? tipoCC[t.conta_contabil_id as string] : null
      if (tc === 'receita' || tc === 'despesa' || tc === 'imposto') {
        const m = d.slice(0, 7)
        porMes[m] ??= { receita: 0, despesa: 0 }
        if (tc === 'receita') porMes[m].receita += v
        else porMes[m].despesa += v
      }
    }
    const rd = (m: string): RD => porMes[m] ?? { receita: 0, despesa: 0 }

    const contas = (contasRaw ?? []).map((c) => ({ nome: c.nome, tipo: c.tipo, saldo: round(saldo[c.id] ?? 0) }))
    const saldoTotal = round(contas.filter((c) => c.tipo === 'corrente').reduce((s, c) => s + c.saldo, 0))
    const dividasLongoPrazo = round(contas.filter((c) => c.tipo === 'emprestimo').reduce((s, c) => s + c.saldo, 0))
    const saldoCartoes = round(contas.filter((c) => c.tipo === 'cartao').reduce((s, c) => s + c.saldo, 0))

    // Mês de referência = mês mais recente com dados
    const ref = ultima ? new Date(Number(ultima.slice(0, 4)), Number(ultima.slice(5, 7)) - 1, 1) : new Date()
    const refMes = ref.getMonth() + 1, refAno = ref.getFullYear()
    const mDado = (off: number) => { const x = new Date(refAno, ref.getMonth() - off, 1); return mesStr(x) }
    const card = (m: string) => ({ label: rotuloMes(m), receita: round(rd(m).receita), despesa: round(rd(m).despesa) })

    // YTD: ano de referência até refMes vs ano anterior mesmo período
    const ytdDe = (ano: number) => {
      let receita = 0, despesa = 0
      for (let mm = 1; mm <= refMes; mm++) { const r = rd(`${ano}-${String(mm).padStart(2, '0')}`); receita += r.receita; despesa += r.despesa }
      return { label: `${ano} (até ${NOMES[refMes - 1]})`, receita: round(receita), despesa: round(despesa), lucro: round(receita - despesa) }
    }

    // Série do gráfico conforme a visão
    const mesesComDados = Object.keys(porMes).sort()
    const ponto = (label: string, r: RD) => ({ label, receita: round(r.receita), despesa: round(r.despesa), lucro: round(r.receita - r.despesa) })
    const somaMeses = (ms: string[]): RD => ms.reduce((a, m) => ({ receita: a.receita + rd(m).receita, despesa: a.despesa + rd(m).despesa }), { receita: 0, despesa: 0 })
    let pontos: { label: string; receita: number; despesa: number; lucro: number }[] = []

    if (visao === 'ano') {
      const anos = Array.from(new Set(mesesComDados.map((m) => m.slice(0, 4)))).sort()
      pontos = anos.map((a) => ponto(a, somaMeses(mesesComDados.filter((m) => m.startsWith(a)))))
    } else if (visao === 'trimestre') {
      const tris = Array.from(new Set(mesesComDados.map((m) => `${m.slice(0, 4)}-T${Math.ceil(Number(m.slice(5, 7)) / 3)}`))).sort()
      pontos = tris.map((t) => {
        const [a, q] = [t.slice(0, 4), Number(t.slice(6))]
        const ms = mesesComDados.filter((m) => m.startsWith(a) && Math.ceil(Number(m.slice(5, 7)) / 3) === q)
        return ponto(`${t.slice(5)}/${a.slice(2)}`, somaMeses(ms))
      })
    } else {
      // visões mensais com diferentes janelas
      let janela = mesesComDados
      if (visao === 'este_ano') janela = mesesComDados.filter((m) => m.startsWith(String(refAno)))
      else if (visao === 'ano_passado') janela = Array.from({ length: refMes }, (_, i) => `${refAno - 1}-${String(i + 1).padStart(2, '0')}`)
      else if (visao === 'ultimo_ano') janela = Array.from({ length: 12 }, (_, i) => mDado(11 - i))
      pontos = janela.map((m) => ponto(rotuloMes(m), rd(m)))
    }

    return NextResponse.json({
      ultimaAtualizacao: ultima,
      contas, saldoTotal, dividasLongoPrazo, saldoCartoes,
      esteMes: card(mDado(0)), mesPassado: card(mDado(1)), mesAnterior: card(mDado(2)),
      ytd: { atual: ytdDe(refAno), anterior: ytdDe(refAno - 1) },
      visao, pontos,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
