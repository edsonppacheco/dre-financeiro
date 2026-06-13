import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calcularDrePlano, type PlanoLinha } from '@/lib/dre-plano'

const ultimoDiaMes = (mes: string) => {
  const [a, m] = mes.split('-').map(Number)
  return `${mes}-${String(new Date(a, m, 0).getDate()).padStart(2, '0')}`
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') // YYYY-MM
    if (!mes) return NextResponse.json({ error: 'mes obrigatório (YYYY-MM)' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    const { data: planoRaw } = await supabase.from('plano_contas').select('id, codigo, nome, tipo, pai_id, ordem').order('ordem')
    if (!planoRaw?.length) return NextResponse.json({ error: 'Nenhum plano de contas' }, { status: 400 })
    const plano = planoRaw as PlanoLinha[]

    // Soma (com sinal) por conta contábil no mês, pela data da transação
    const { data: txs } = await supabase
      .from('transacoes')
      .select('valor, tipo, conta_contabil_id')
      .not('conta_contabil_id', 'is', null)
      .gte('data', `${mes}-01`)
      .lte('data', ultimoDiaMes(mes))

    const somaPorConta: Record<string, number> = {}
    for (const t of txs ?? []) {
      const v = t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor)
      somaPorConta[t.conta_contabil_id as string] = (somaPorConta[t.conta_contabil_id as string] ?? 0) + v
    }

    const { linhas, lucroLiquido } = calcularDrePlano(plano, somaPorConta)

    // Gera Excel
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'DRE Financeiro'

    const sheet = workbook.addWorksheet('DRE')

    // Cabeçalho
    sheet.mergeCells('A1:C1')
    const title = sheet.getCell('A1')
    title.value = `Demonstração do Resultado do Exercício — ${mes}`
    title.font = { bold: true, size: 14 }
    title.alignment = { horizontal: 'center' }

    sheet.addRow([])
    sheet.addRow(['Código', 'Descrição', 'Valor (R$)'])
    const headerRow = sheet.lastRow!
    headerRow.font = { bold: true }
    headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A5F' } }
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } }

    sheet.columns = [
      { key: 'codigo', width: 12 },
      { key: 'descricao', width: 45 },
      { key: 'valor', width: 18 },
    ]

    for (const linha of linhas) {
      const isGrupo = linha.tipo === 'grupo'
      const row = sheet.addRow([linha.codigo, linha.nome, linha.valor])

      if (isGrupo) {
        row.font = { bold: true, size: 11 }
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } }
      }
      row.getCell(3).numFmt = 'R$ #,##0.00;[Red](R$ #,##0.00)'
    }

    // Lucro líquido
    const totalRow = sheet.addRow(['', 'Lucro Líquido', lucroLiquido])
    totalRow.font = { bold: true, color: { argb: lucroLiquido >= 0 ? 'FF1A6B3A' : 'FFB91C1C' } }
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
    totalRow.getCell(3).numFmt = 'R$ #,##0.00;[Red](R$ #,##0.00)'

    // Bordas na tabela
    sheet.eachRow((row, rowNum) => {
      if (rowNum < 3) return
      row.eachCell((cell) => {
        cell.border = {
          bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        }
      })
    })

    const buffer = await workbook.xlsx.writeBuffer()

    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="DRE-${mes}.xlsx"`,
      },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
