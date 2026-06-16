import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { calcularDreMulti, type PlanoLinha } from '@/lib/dre-plano'
import { obterTaxasMensais, converterComTaxas } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'

type TxAgg = { conta_id: string; data: string; valor: number; tipo: string; conta_contabil_id: string | null }
type TransfAgg = { conta_origem_id: string; conta_destino_id: string; data: string; valor: number; valor_destino: number | null }

const MES_ABBR = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ultimoDia = (ano: number, mes: number) => String(new Date(ano, mes, 0).getDate()).padStart(2, '0')

type Coluna = { chave: string; label: string; inicio: string; fim: string }

// GET /api/dre?ano=YYYY&visao=...&empresas=id1,id2&moeda=USD|BRL
//
// Tratamento contábil padrão para consolidação multi-moeda:
// - Itens de fluxo (receita/despesa/lucro, distribuição, lucros retidos):
//   cada transação convertida pela taxa MÉDIA do seu próprio mês, depois somada
//   (método da taxa média ponderada — o de praxe para DRE).
// - Itens de balanço (saldo de contas/dívidas): saldo nativo acumulado por
//   conta, convertido pela taxa de FECHAMENTO do mês final da coluna (método
//   da taxa corrente — o de praxe para itens monetários de balanço).
// - Capital inicial: convertido pela taxa do mês mais antigo disponível (taxa
//   histórica — itens de patrimônio não são retraduzidos pela taxa corrente).
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    // Contas + empresas (moeda) — base do filtro e da conversão
    const [{ data: contasRaw }, { data: empresasRaw }] = await Promise.all([
      supabase.from('contas').select('id, tipo, saldo_inicial, empresa_id'),
      supabase.from('empresas').select('id, moeda'),
    ])
    const moedaEmpresa: Record<string, Moeda> = {}
    for (const e of empresasRaw ?? []) moedaEmpresa[e.id as string] = (e.moeda as Moeda) ?? 'BRL'
    const contasFiltradas = (contasRaw ?? []).filter((c) => !empresaIds.length || empresaIds.includes(c.empresa_id ?? ''))
    const contaIds = contasFiltradas.map((c) => c.id)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const noConjunto = (q: any) => (empresaIds.length ? q.in('conta_id', contaIds) : q)
    const moedaPorConta: Record<string, Moeda> = {}
    for (const c of contasFiltradas) moedaPorConta[c.id] = moedaEmpresa[c.empresa_id ?? ''] ?? 'BRL'
    const moedasEmUso = new Set(Object.values(moedaPorConta))
    const combinada = moedasEmUso.size > 1
    const moeda: Moeda = combinada ? moedaParam : ((Object.values(moedaPorConta)[0] as Moeda) ?? 'BRL')

    // Anos disponíveis (das datas reais das transações classificadas, dentro das contas em vista)
    const datasRows = await selectAll<{ data: string }>(
      () => noConjunto(supabase.from('transacoes').select('data').not('conta_contabil_id', 'is', null))
    )
    const todasDatas = datasRows.map((d) => d.data)
    const anos = Array.from(new Set(todasDatas.map((d) => Number(d.slice(0, 4))))).sort((a, b) => b - a)
    const ano = Number(searchParams.get('ano')) || anos[0] || new Date().getFullYear()
    const visao = (searchParams.get('visao') ?? 'meses') as 'ano' | 'trimestres' | 'meses' | 'trimestre' | 'mes' | 'anos'

    // Meses/trimestres do ano que têm dados (para não mostrar colunas vazias)
    const mesesComDados = new Set(todasDatas.filter((d) => d.startsWith(`${ano}-`)).map((d) => Number(d.slice(5, 7))))
    const trimComDados = new Set(Array.from(mesesComDados).map((m) => Math.ceil(m / 3)))

    const colMes = (m: number): Coluna => ({ chave: `${ano}-${String(m).padStart(2, '0')}`, label: MES_ABBR[m], inicio: `${ano}-${String(m).padStart(2, '0')}-01`, fim: `${ano}-${String(m).padStart(2, '0')}-${ultimoDia(ano, m)}` })
    const colTrim = (q: number): Coluna => { const mi = (q - 1) * 3 + 1, mf = q * 3; return { chave: `${ano}-T${q}`, label: `T${q}`, inicio: `${ano}-${String(mi).padStart(2, '0')}-01`, fim: `${ano}-${String(mf).padStart(2, '0')}-${ultimoDia(ano, mf)}` } }

    let colunas: Coluna[] = []
    if (visao === 'anos') colunas = anos.slice(0, 5).reverse().map((a) => ({ chave: `${a}`, label: `${a}`, inicio: `${a}-01-01`, fim: `${a}-12-31` }))
    else if (visao === 'ano') colunas = [{ chave: `${ano}`, label: `${ano}`, inicio: `${ano}-01-01`, fim: `${ano}-12-31` }]
    else if (visao === 'trimestres') colunas = [1, 2, 3, 4].filter((q) => trimComDados.has(q)).map(colTrim)
    else if (visao === 'trimestre') { const q = Number(searchParams.get('trimestre')) || 1; colunas = [colTrim(q)] }
    else if (visao === 'mes') { const m = Number(searchParams.get('mes')) || 1; colunas = [colMes(m)] }
    else colunas = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => mesesComDados.has(m)).map(colMes)

    // Intervalo de datas coberto pelas colunas (suporta plurianual)
    const rangeIni = colunas[0]?.inicio ?? `${ano}-01-01`
    const rangeFim = colunas[colunas.length - 1]?.fim ?? `${ano}-12-31`

    const { data: planoRaw } = await supabase.from('plano_contas').select('id, codigo, nome, tipo, pai_id, ordem').order('ordem')
    const plano = (planoRaw ?? []) as PlanoLinha[]

    // Busca transações do intervalo de uma vez
    const txs = await selectAll<TxAgg>(
      () => noConjunto(supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id')
        .not('conta_contabil_id', 'is', null).gte('data', rangeIni).lte('data', rangeFim))
    )

    // Todas as transações até o fim do intervalo (cumulativo p/ saldos e lucros retidos)
    const txAll = await selectAll<TxAgg>(
      () => noConjunto(supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id').lte('data', rangeFim))
    )

    // Transferências do intervalo (para recebimento/pagamento de empréstimos por período)
    let transfsQuery = supabase.from('transferencias').select('conta_origem_id, conta_destino_id, data, valor, valor_destino').gte('data', rangeIni).lte('data', rangeFim)
    if (empresaIds.length) transfsQuery = transfsQuery.in('conta_origem_id', contaIds)
    const { data: transfsRaw } = await transfsQuery
    const transfs = (transfsRaw ?? []) as TransfAgg[]

    // Taxas de câmbio dos meses envolvidos, buscadas de uma vez
    const mesesEnvolvidos = new Set<string>()
    for (const t of [...txs, ...txAll]) mesesEnvolvidos.add(t.data.slice(0, 7))
    for (const t of transfs) mesesEnvolvidos.add(t.data.slice(0, 7))
    for (const col of colunas) mesesEnvolvidos.add(col.fim.slice(0, 7))
    const mesMaisAntigo = todasDatas.length ? [...todasDatas].sort()[0].slice(0, 7) : rangeIni.slice(0, 7)
    mesesEnvolvidos.add(mesMaisAntigo)
    // Mês corrente: a cotação atual serve de fallback p/ saldo do período em
    // andamento, cujo fim (ex: dez do ano corrente) ainda não tem taxa.
    mesesEnvolvidos.add(new Date().toISOString().slice(0, 7))
    // Lê só do banco (sem buscar na AwesomeAPI no request); avisa se faltar.
    const taxas = combinada ? await obterTaxasMensais([...mesesEnvolvidos], false) : {}
    const cambioIndisponivel = combinada && Object.keys(taxas).length === 0
    const conv = (valor: number, deMoeda: Moeda, mes: string) => combinada ? converterComTaxas(valor, deMoeda, moeda, mes, taxas) : valor

    // Soma por conta contábil, por coluna — cada transação convertida pela taxa
    // do seu próprio mês (taxa média ponderada, padrão para itens de fluxo/DRE)
    const somasPorColuna: Record<string, Record<string, number>> = {}
    for (const col of colunas) somasPorColuna[col.chave] = {}
    for (const t of txs) {
      const v = conv(t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor), moedaPorConta[t.conta_id], t.data.slice(0, 7))
      for (const col of colunas) {
        if (t.data >= col.inicio && t.data <= col.fim) {
          const m = somasPorColuna[col.chave]
          m[t.conta_contabil_id as string] = (m[t.conta_contabil_id as string] ?? 0) + v
        }
      }
    }

    const chaves = colunas.map((c) => c.chave)
    const { linhas, lucroLiquido } = calcularDreMulti(plano, chaves, somasPorColuna)

    // ---- Balanço (foto no fim de cada coluna) ----
    const round = (x: number) => Math.round(x * 100) / 100
    const tipoConta: Record<string, string> = {}
    const saldoIni: Record<string, number> = {}
    for (const c of contasFiltradas) { tipoConta[c.id] = c.tipo; saldoIni[c.id] = Number(c.saldo_inicial ?? 0) }

    const distribIds = new Set(plano.filter((p) => p.tipo === 'distribuicao').map((p) => p.id))
    const ehDistrib = (contaContabilId: string | null) => !!contaContabilId && distribIds.has(contaContabilId)

    // Capital inicial: convertido pela taxa histórica (mês mais antigo disponível),
    // somando cada conta já na moeda final (não soma valores nativos misturados)
    const capitalInicial = round(contasFiltradas.reduce((s, c) => s + conv(Number(c.saldo_inicial ?? 0), moedaPorConta[c.id], mesMaisAntigo), 0))

    const balanco: Record<string, {
      contasCorrentes: number; cartoes: number; emprestimos: number; capitalInicial: number
      lucroLiquido: number; lucrosDistribuidos: number; lucrosRetidos: number
      totalAtivos: number; totalPassivosPL: number
    }> = {}
    const serie: Record<string, { distribuicaoMes: number; recebimentoEmprestimos: number; pagamentoEmprestimos: number }> = {}

    for (const col of colunas) {
      const mesFim = col.fim.slice(0, 7)
      // Saldo nativo acumulado por conta até o fim da coluna
      const saldoNativoPorConta: Record<string, number> = { ...saldoIni }
      let retido = 0, distribAcum = 0, distribMes = 0
      for (const t of txAll) {
        if (t.data > col.fim) continue
        const signed = t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
        saldoNativoPorConta[t.conta_id] = (saldoNativoPorConta[t.conta_id] ?? 0) + signed
        // Itens de fluxo (retido/distribuído): convertidos pela taxa do próprio mês
        const vConv = conv(signed, moedaPorConta[t.conta_id], t.data.slice(0, 7))
        if (ehDistrib(t.conta_contabil_id)) distribAcum += -vConv // acumulado distribuído (magnitude)
        else if (t.conta_contabil_id && t.data < col.inicio) retido += vConv // lucro de períodos passados
        if (ehDistrib(t.conta_contabil_id) && t.data >= col.inicio && t.data <= col.fim) distribMes += -vConv
      }
      // Saldos de balanço: taxa de FECHAMENTO do mês final da coluna (taxa corrente)
      let corr = 0, cart = 0, empr = 0
      for (const c of contasFiltradas) {
        const v = conv(saldoNativoPorConta[c.id] ?? 0, moedaPorConta[c.id], mesFim)
        if (c.tipo === 'corrente') corr += v
        else if (c.tipo === 'cartao') cart += v
        else if (c.tipo === 'emprestimo') empr += v
      }

      // empréstimos: recebimento (origem=empréstimo) e pagamento (destino=empréstimo) no período
      let receb = 0, pag = 0
      for (const tr of transfs) {
        if (tr.data < col.inicio || tr.data > col.fim) continue
        if (tipoConta[tr.conta_origem_id] === 'emprestimo') receb += conv(Number(tr.valor), moedaPorConta[tr.conta_origem_id], tr.data.slice(0, 7))
        if (tipoConta[tr.conta_destino_id] === 'emprestimo') pag += conv(Number(tr.valor_destino ?? tr.valor), moedaPorConta[tr.conta_destino_id], tr.data.slice(0, 7))
      }

      const lucroPeriodo = lucroLiquido[col.chave]
      const totalAtivos = round(corr)
      // Passivos (dívidas = -saldo de empréstimo/cartão) + Patrimônio (capital + lucros - distribuídos)
      const totalPassivosPL = round(-empr - cart + capitalInicial + lucroPeriodo + retido - distribAcum)
      balanco[col.chave] = {
        contasCorrentes: round(corr), cartoes: round(cart), emprestimos: round(empr), capitalInicial,
        lucroLiquido: lucroPeriodo, lucrosDistribuidos: round(distribAcum), lucrosRetidos: round(retido),
        totalAtivos, totalPassivosPL,
      }
      serie[col.chave] = { distribuicaoMes: round(distribMes), recebimentoEmprestimos: round(receb), pagamentoEmprestimos: round(pag) }
    }

    // Transferências entre empresas distintas dentro do período — referência
    // (já não entram na DRE: conta_contabil_id é zerado nos dois lançamentos).
    const transferenciasReferencia: {
      data: string; contaOrigem: string; contaDestino: string
      valorOrigem: number; moedaOrigem: Moeda; valorDestino: number; moedaDestino: Moeda
    }[] = []
    if (combinada) {
      type TransfRow = {
        data: string; valor: number; valor_destino: number | null
        origem: { id: string; nome: string; empresa_id: string | null } | null
        destino: { id: string; nome: string; empresa_id: string | null } | null
      }
      const { data: transfsRef } = await supabase
        .from('transferencias')
        .select('data, valor, valor_destino, origem:conta_origem_id(id, nome, empresa_id), destino:conta_destino_id(id, nome, empresa_id)')
        .gte('data', rangeIni).lte('data', rangeFim)
        .order('data', { ascending: false })
      for (const t of (transfsRef ?? []) as unknown as TransfRow[]) {
        const empresaOrigem = t.origem?.empresa_id ?? null
        const empresaDestino = t.destino?.empresa_id ?? null
        const dentroDaVisao = !empresaIds.length || (empresaIds.includes(empresaOrigem ?? '') && empresaIds.includes(empresaDestino ?? ''))
        if (!dentroDaVisao || empresaOrigem === empresaDestino) continue
        transferenciasReferencia.push({
          data: t.data,
          contaOrigem: t.origem?.nome ?? '—', contaDestino: t.destino?.nome ?? '—',
          valorOrigem: Number(t.valor), moedaOrigem: moedaEmpresa[empresaOrigem ?? ''] ?? 'BRL',
          valorDestino: Number(t.valor_destino ?? t.valor), moedaDestino: moedaEmpresa[empresaDestino ?? ''] ?? 'BRL',
        })
      }
    }

    return NextResponse.json({ anos, ano, visao, colunas, linhas, lucroLiquido, balanco, serie, totalTransacoes: txs.length, moeda, combinada, cambioIndisponivel, transferenciasReferencia })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
