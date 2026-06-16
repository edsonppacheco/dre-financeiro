import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { calcularDreMulti, type PlanoLinha } from '@/lib/dre-plano'
import { obterTaxasMensais, converterComTaxas } from '@/lib/cambio'
import type { Moeda } from '@/lib/formato'

type TxAgg = { conta_id: string; data: string; valor: number; tipo: string; conta_contabil_id: string | null }

const MES_ABBR = ['', 'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez']
const ultimoDia = (ano: number, mes: number) => String(new Date(ano, mes, 0).getDate()).padStart(2, '0')
type Coluna = { chave: string; label: string; inicio: string; fim: string }

// GET /api/exportar?ano=YYYY&visao=...&empresas=id1,id2&moeda=USD|BRL
// Mesmo critério de filtro/conversão do /api/dre (cada transação convertida
// pela taxa média do seu próprio mês).
export async function GET(req: NextRequest) {
  try {
    const supabase = createSupabaseAdminClient()
    const { searchParams } = new URL(req.url)
    const empresaIds = (searchParams.get('empresas') ?? '').split(',').filter(Boolean)
    const moedaParam = (searchParams.get('moeda') as Moeda) === 'USD' ? 'USD' : 'BRL'

    const [{ data: contasRaw }, { data: empresasRaw }] = await Promise.all([
      supabase.from('contas').select('id, empresa_id'),
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
    const combinada = new Set(Object.values(moedaPorConta)).size > 1
    const moeda: Moeda = combinada ? moedaParam : ((Object.values(moedaPorConta)[0] as Moeda) ?? 'BRL')

    const datas = await selectAll<{ data: string }>(
      () => noConjunto(supabase.from('transacoes').select('data').not('conta_contabil_id', 'is', null))
    )
    const todasDatas = datas.map((d) => d.data)
    const anos = Array.from(new Set(todasDatas.map((d) => Number(d.slice(0, 4))))).sort((a, b) => b - a)
    const ano = Number(searchParams.get('ano')) || anos[0] || new Date().getFullYear()
    const visao = (searchParams.get('visao') ?? 'meses') as 'ano' | 'trimestres' | 'meses' | 'trimestre' | 'mes' | 'anos'

    const mesesComDados = new Set(todasDatas.filter((d) => d.startsWith(`${ano}-`)).map((d) => Number(d.slice(5, 7))))
    const trimComDados = new Set(Array.from(mesesComDados).map((m) => Math.ceil(m / 3)))
    const colMes = (m: number): Coluna => ({ chave: `${ano}-${String(m).padStart(2, '0')}`, label: MES_ABBR[m], inicio: `${ano}-${String(m).padStart(2, '0')}-01`, fim: `${ano}-${String(m).padStart(2, '0')}-${ultimoDia(ano, m)}` })
    const colTrim = (q: number): Coluna => { const mi = (q - 1) * 3 + 1, mf = q * 3; return { chave: `${ano}-T${q}`, label: `T${q}`, inicio: `${ano}-${String(mi).padStart(2, '0')}-01`, fim: `${ano}-${String(mf).padStart(2, '0')}-${ultimoDia(ano, mf)}` } }

    let colunas: Coluna[] = []
    if (visao === 'anos') colunas = anos.slice(0, 5).reverse().map((a) => ({ chave: `${a}`, label: `${a}`, inicio: `${a}-01-01`, fim: `${a}-12-31` }))
    else if (visao === 'ano') colunas = [{ chave: `${ano}`, label: `${ano}`, inicio: `${ano}-01-01`, fim: `${ano}-12-31` }]
    else if (visao === 'trimestres') colunas = [1, 2, 3, 4].filter((q) => trimComDados.has(q)).map(colTrim)
    else if (visao === 'trimestre') colunas = [colTrim(Number(searchParams.get('trimestre')) || 1)]
    else if (visao === 'mes') colunas = [colMes(Number(searchParams.get('mes')) || 1)]
    else colunas = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => mesesComDados.has(m)).map(colMes)

    const { data: planoRaw } = await supabase.from('plano_contas').select('id, codigo, nome, tipo, pai_id, ordem').order('ordem')
    const plano = (planoRaw ?? []) as PlanoLinha[]

    const rangeIni = colunas[0]?.inicio ?? `${ano}-01-01`
    const rangeFim = colunas[colunas.length - 1]?.fim ?? `${ano}-12-31`
    const txs = await selectAll<TxAgg>(
      () => noConjunto(supabase.from('transacoes').select('conta_id, data, valor, tipo, conta_contabil_id')
        .not('conta_contabil_id', 'is', null).gte('data', rangeIni).lte('data', rangeFim))
    )

    const taxas = combinada ? await obterTaxasMensais(txs.map((t) => t.data.slice(0, 7))) : {}
    const conv = (valor: number, deMoeda: Moeda, mes: string) => combinada ? converterComTaxas(valor, deMoeda, moeda, mes, taxas) : valor

    const somasPorColuna: Record<string, Record<string, number>> = {}
    for (const col of colunas) somasPorColuna[col.chave] = {}
    for (const t of txs) {
      const v = conv(t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor), moedaPorConta[t.conta_id], t.data.slice(0, 7))
      for (const col of colunas) if (t.data >= col.inicio && t.data <= col.fim) {
        const m = somasPorColuna[col.chave]; m[t.conta_contabil_id as string] = (m[t.conta_contabil_id as string] ?? 0) + v
      }
    }

    const chaves = colunas.map((c) => c.chave)
    const { linhas, lucroLiquido } = calcularDreMulti(plano, chaves, somasPorColuna)

    // Excel
    const wb = new ExcelJS.Workbook()
    wb.creator = 'DRE Financeiro'
    const sheet = wb.addWorksheet('DRE')
    const nCols = colunas.length
    const numFmt = moeda === 'USD' ? '$ #,##0.00;[Red]($ #,##0.00)' : 'R$ #,##0.00;[Red](R$ #,##0.00)'

    sheet.mergeCells(1, 1, 1, nCols + 2)
    const title = sheet.getCell('A1')
    title.value = `DRE — ${ano} (${visao})${combinada ? ` · combinada, convertido para ${moeda}` : ''}`
    title.font = { bold: true, size: 14 }
    title.alignment = { horizontal: 'center' }
    sheet.addRow([])

    const header = sheet.addRow(['Cód.', 'Conta', ...colunas.map((c) => c.label)])
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    header.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } } })
    sheet.getColumn(1).width = 8
    sheet.getColumn(2).width = 36
    for (let i = 0; i < nCols; i++) sheet.getColumn(3 + i).width = 16

    for (const l of linhas) {
      const row = sheet.addRow([l.codigo, l.nome, ...chaves.map((k) => l.valores[k] ?? 0)])
      if (l.tipo === 'grupo') { row.font = { bold: true }; row.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } } }) }
      for (let i = 0; i < nCols; i++) row.getCell(3 + i).numFmt = numFmt
    }
    const totalRow = sheet.addRow(['', 'Lucro Líquido', ...chaves.map((k) => lucroLiquido[k] ?? 0)])
    totalRow.font = { bold: true }
    totalRow.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } } })
    for (let i = 0; i < nCols; i++) totalRow.getCell(3 + i).numFmt = numFmt

    const buffer = await wb.xlsx.writeBuffer()
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="DRE-${ano}-${visao}${combinada ? `-${moeda}` : ''}.xlsx"`,
      },
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
