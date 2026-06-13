import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calcularDreMulti, type PlanoLinha } from '@/lib/dre-plano'

const MES_ABBR = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ultimoDia = (ano: number, mes: number) => String(new Date(ano, mes, 0).getDate()).padStart(2, '0')

type Coluna = { chave: string; label: string; inicio: string; fim: string }

// GET /api/dre?ano=YYYY&visao=ano|trimestres|meses|trimestre|mes [&trimestre=1..4] [&mes=MM]
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)

    // Anos disponíveis (das datas reais das transações classificadas)
    const { data: datas } = await supabase.from('transacoes').select('data').not('conta_contabil_id', 'is', null)
    const todasDatas = (datas ?? []).map((d) => d.data as string)
    const anos = Array.from(new Set(todasDatas.map((d) => Number(d.slice(0, 4))))).sort((a, b) => b - a)
    const ano = Number(searchParams.get('ano')) || anos[0] || new Date().getFullYear()
    const visao = (searchParams.get('visao') ?? 'meses') as 'ano' | 'trimestres' | 'meses' | 'trimestre' | 'mes'

    // Meses/trimestres do ano que têm dados (para não mostrar colunas vazias)
    const mesesComDados = new Set(todasDatas.filter((d) => d.startsWith(`${ano}-`)).map((d) => Number(d.slice(5, 7))))
    const trimComDados = new Set(Array.from(mesesComDados).map((m) => Math.ceil(m / 3)))

    const colMes = (m: number): Coluna => ({ chave: `${ano}-${String(m).padStart(2, '0')}`, label: MES_ABBR[m], inicio: `${ano}-${String(m).padStart(2, '0')}-01`, fim: `${ano}-${String(m).padStart(2, '0')}-${ultimoDia(ano, m)}` })
    const colTrim = (q: number): Coluna => { const mi = (q - 1) * 3 + 1, mf = q * 3; return { chave: `${ano}-T${q}`, label: `T${q}`, inicio: `${ano}-${String(mi).padStart(2, '0')}-01`, fim: `${ano}-${String(mf).padStart(2, '0')}-${ultimoDia(ano, mf)}` } }

    let colunas: Coluna[] = []
    if (visao === 'ano') colunas = [{ chave: `${ano}`, label: `${ano}`, inicio: `${ano}-01-01`, fim: `${ano}-12-31` }]
    else if (visao === 'trimestres') colunas = [1, 2, 3, 4].filter((q) => trimComDados.has(q)).map(colTrim)
    else if (visao === 'trimestre') { const q = Number(searchParams.get('trimestre')) || 1; colunas = [colTrim(q)] }
    else if (visao === 'mes') { const m = Number(searchParams.get('mes')) || 1; colunas = [colMes(m)] }
    else colunas = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => mesesComDados.has(m)).map(colMes)

    const { data: planoRaw } = await supabase.from('plano_contas').select('id, codigo, nome, tipo, pai_id, ordem').order('ordem')
    const plano = (planoRaw ?? []) as PlanoLinha[]

    // Busca transações do ano de uma vez
    const { data: txs } = await supabase
      .from('transacoes')
      .select('data, valor, tipo, conta_contabil_id')
      .not('conta_contabil_id', 'is', null)
      .gte('data', `${ano}-01-01`)
      .lte('data', `${ano}-12-31`)

    // Soma por conta, por coluna
    const somasPorColuna: Record<string, Record<string, number>> = {}
    for (const col of colunas) somasPorColuna[col.chave] = {}
    for (const t of txs ?? []) {
      const v = t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
      for (const col of colunas) {
        if ((t.data as string) >= col.inicio && (t.data as string) <= col.fim) {
          const m = somasPorColuna[col.chave]
          m[t.conta_contabil_id as string] = (m[t.conta_contabil_id as string] ?? 0) + v
        }
      }
    }

    const chaves = colunas.map((c) => c.chave)
    const { linhas, lucroLiquido } = calcularDreMulti(plano, chaves, somasPorColuna)

    // ---- Balanço (foto no fim de cada coluna) ----
    const round = (x: number) => Math.round(x * 100) / 100
    const { data: contasRaw } = await supabase.from('contas').select('id, tipo, saldo_inicial')
    const tipoConta: Record<string, string> = {}
    const saldoIni: Record<string, number> = {}
    for (const c of contasRaw ?? []) { tipoConta[c.id] = c.tipo; saldoIni[c.id] = Number(c.saldo_inicial ?? 0) }

    // Todas as transações até o fim do ano (cumulativo p/ saldos e lucros retidos)
    const { data: txAll } = await supabase
      .from('transacoes')
      .select('conta_id, data, valor, tipo, conta_contabil_id')
      .lte('data', `${ano}-12-31`)

    const distribIds = plano.filter((p) => p.tipo === 'distribuicao').map((p) => p.id)
    const balanco: Record<string, {
      contasCorrentes: number; cartoes: number; emprestimos: number
      lucroLiquido: number; lucrosDistribuidos: number; lucrosRetidos: number
    }> = {}

    for (const col of colunas) {
      let corr = 0, cart = 0, empr = 0, retido = 0
      for (const c of contasRaw ?? []) {
        if (tipoConta[c.id] === 'corrente') corr += saldoIni[c.id]
        else if (tipoConta[c.id] === 'cartao') cart += saldoIni[c.id]
        else if (tipoConta[c.id] === 'emprestimo') empr += saldoIni[c.id]
      }
      for (const t of txAll ?? []) {
        if ((t.data as string) > col.fim) continue
        const signed = t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
        const tp = tipoConta[t.conta_id as string]
        if (tp === 'corrente') corr += signed
        else if (tp === 'cartao') cart += signed
        else if (tp === 'emprestimo') empr += signed
        if (t.conta_contabil_id) retido += signed // lucro acumulado (retido)
      }
      const distribPeriodo = distribIds.reduce((s, id) => s + (somasPorColuna[col.chave]?.[id] ?? 0), 0)
      balanco[col.chave] = {
        contasCorrentes: round(corr),
        cartoes: round(cart),
        emprestimos: round(empr),
        lucroLiquido: lucroLiquido[col.chave],
        lucrosDistribuidos: round(-distribPeriodo), // magnitude (saída)
        lucrosRetidos: round(retido),
      }
    }

    return NextResponse.json({ anos, ano, visao, colunas, linhas, lucroLiquido, balanco, totalTransacoes: (txs ?? []).length })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
