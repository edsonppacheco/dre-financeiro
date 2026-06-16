import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { obterTaxasMensais, converterComTaxas } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'

const round = (x: number) => Math.round(x * 100) / 100
const mesStr = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const NOMES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const rotuloMes = (m: string) => { const [a, mm] = m.split('-'); return `${NOMES[Number(mm) - 1]}/${a.slice(2)}` }

type RD = { receita: number; despesa: number }

// GET /api/dashboard?visao=...&empresas=id1,id2&moeda=USD|BRL
// `empresas` filtra as contas exibidas (vazio = todas). Quando há 2+ empresas
// (ou moedas) na visão, os valores são convertidos para `moeda` usando a média
// mensal do câmbio do mês de cada transação (saldos, que são um instantâneo,
// usam a taxa do mês mais recente com dados).
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const visao = searchParams.get('visao') ?? 'mes'
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    const [{ data: contasRaw }, { data: planoRaw }, { data: empresasRaw }, txAll] = await Promise.all([
      supabase.from('contas').select('id, nome, tipo, saldo_inicial, empresa_id'),
      supabase.from('plano_contas').select('id, tipo'),
      supabase.from('empresas').select('id, moeda'),
      selectAll<{ conta_id: string; data: string; valor: number; tipo: string; conta_contabil_id: string | null }>(
        () => supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id')
      ),
    ])

    const tipoCC: Record<string, string> = {}
    for (const p of planoRaw ?? []) tipoCC[p.id] = p.tipo
    const moedaEmpresa: Record<string, Moeda> = {}
    for (const e of empresasRaw ?? []) moedaEmpresa[e.id as string] = (e.moeda as Moeda) ?? 'BRL'

    // Filtra contas pelas empresas selecionadas (vazio = todas)
    const contasFiltradas = (contasRaw ?? []).filter((c) => !empresaIds.length || empresaIds.includes(c.empresa_id ?? ''))
    const contaIds = new Set(contasFiltradas.map((c) => c.id))
    const moedaPorConta: Record<string, Moeda> = {}
    for (const c of contasFiltradas) moedaPorConta[c.id] = moedaEmpresa[c.empresa_id ?? ''] ?? 'BRL'

    const txFiltradas = (txAll ?? []).filter((t) => contaIds.has(t.conta_id))

    // Moeda final da visão: se só há uma moeda entre as contas em vista, usa-a
    // direto (sem conversão); senão usa a escolhida pelo usuário (default USD).
    const moedasEmUso = new Set(Object.values(moedaPorConta))
    const combinada = moedasEmUso.size > 1
    const moeda: Moeda = combinada ? moedaParam : ((Object.values(moedaPorConta)[0] as Moeda) ?? 'BRL')

    // Taxas dos meses envolvidos (cada transação pelo seu mês) + mês corrente,
    // cuja taxa é a "cotação atual" usada para converter os saldos.
    const mesAtual = new Date().toISOString().slice(0, 7)
    let ultima: string | null = null
    for (const t of txFiltradas) if (!ultima || (t.data as string) > ultima) ultima = t.data as string
    const mesesEnvolvidos = Array.from(new Set(txFiltradas.map((t) => (t.data as string).slice(0, 7))))
    mesesEnvolvidos.push(mesAtual)
    const taxas = combinada ? await obterTaxasMensais(mesesEnvolvidos) : {}
    const conv = (valor: number, deMoeda: Moeda, mes: string) => combinada ? converterComTaxas(valor, deMoeda, moeda, mes, taxas) : valor

    // Saldos por conta (acumulados na moeda nativa, convertidos só no final) +
    // mapa mensal de receita/despesa (cada transação convertida pela taxa do
    // seu próprio mês — tratamento mês a mês, mais preciso que uma taxa única).
    const saldoNativo: Record<string, number> = {}
    for (const c of contasFiltradas) saldoNativo[c.id] = Number(c.saldo_inicial ?? 0)
    const porMes: Record<string, RD> = {}
    for (const t of txFiltradas) {
      const vNativo = Number(t.valor)
      const cid = t.conta_id as string
      saldoNativo[cid] = (saldoNativo[cid] ?? 0) + (t.tipo === 'credito' ? vNativo : -vNativo)
      const d = t.data as string
      const tc = t.conta_contabil_id ? tipoCC[t.conta_contabil_id as string] : null
      if (tc === 'receita' || tc === 'despesa' || tc === 'imposto') {
        const m = d.slice(0, 7)
        const v = conv(vNativo, moedaPorConta[cid], m)
        porMes[m] ??= { receita: 0, despesa: 0 }
        if (tc === 'receita') porMes[m].receita += v
        else porMes[m].despesa += v
      }
    }
    const rd = (m: string): RD => porMes[m] ?? { receita: 0, despesa: 0 }

    // Saldos = posição atual → convertidos pela cotação atual (mês corrente).
    // O resolverTaxa cai para a taxa disponível mais recente se o mês corrente
    // ainda não tiver cotação registrada.
    const contas = contasFiltradas.map((c) => ({
      nome: c.nome, tipo: c.tipo,
      saldo: round(conv(saldoNativo[c.id] ?? 0, moedaPorConta[c.id], mesAtual)),
    }))
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

    // Transferências entre empresas distintas dentro da visão — exibidas como
    // referência (já não entram em receita/despesa: ao marcar a transferência,
    // conta_contabil_id é zerado nos dois lançamentos).
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
      const { data: transfs } = await supabase
        .from('transferencias')
        .select('data, valor, valor_destino, origem:conta_origem_id(id, nome, empresa_id), destino:conta_destino_id(id, nome, empresa_id)')
        .order('data', { ascending: false })
        .limit(50)

      for (const t of (transfs ?? []) as unknown as TransfRow[]) {
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

    return NextResponse.json({
      moeda, combinada,
      ultimaAtualizacao: ultima,
      contas, saldoTotal, dividasLongoPrazo, saldoCartoes,
      esteMes: card(mDado(0)), mesPassado: card(mDado(1)), mesAnterior: card(mDado(2)),
      ytd: { atual: ytdDe(refAno), anterior: ytdDe(refAno - 1) },
      visao, pontos,
      transferenciasReferencia,
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
