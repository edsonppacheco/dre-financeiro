import { NextRequest, NextResponse } from 'next/server'
import ExcelJS from 'exceljs'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { calcularDre, type ItemClassificado, type LinhaDreBase } from '@/lib/dre'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const mes = searchParams.get('mes') // YYYY-MM
    if (!mes) return NextResponse.json({ error: 'mes obrigatório (YYYY-MM)' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    const { data: linhasRaw } = await supabase.from('linhas_dre').select('codigo, nome, tipo, ordem').order('ordem')
    if (!linhasRaw?.length) return NextResponse.json({ error: 'Nenhuma linha DRE' }, { status: 400 })
    const linhasBase = linhasRaw as LinhaDreBase[]

    // Agrega valores por linha DRE no mês (respeitando correções)
    const { data: agregado } = await supabase
      .from('classificacoes')
      .select('linha_dre, corrigido_para, transacoes!inner(valor, tipo, extratos!inner(mes_referencia))')
      .eq('transacoes.extratos.mes_referencia', `${mes}-01`)

    const itens: ItemClassificado[] = (agregado ?? [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((c: any) => (c.transacoes ? { linha_dre: c.linha_dre, corrigido_para: c.corrigido_para, valor: c.transacoes.valor, tipo: c.transacoes.tipo } : null))
      .filter((x): x is ItemClassificado => x !== null)

    const linhas = calcularDre(linhasBase, itens)

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
      const isResultado = linha.tipo === 'resultado'
      const valor = linha.valor

      const row = sheet.addRow([linha.codigo, linha.nome, valor])

      if (isGrupo) {
        row.font = { bold: true, size: 11 }
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EDF2' } }
      } else if (isResultado) {
        row.font = { bold: true, color: { argb: valor && valor >= 0 ? 'FF1A6B3A' : 'FFB91C1C' } }
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } }
      }

      const valorCell = row.getCell(3)
      valorCell.numFmt = 'R$ #,##0.00;[Red](R$ #,##0.00)'
    }

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
