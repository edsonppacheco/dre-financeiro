import ExcelJS from 'exceljs'

export type TransacaoParsed = {
  data: string
  descricao: string
  valor: number
  tipo: 'credito' | 'debito'
}

export async function parseExcel(buffer: ArrayBuffer): Promise<TransacaoParsed[]> {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)

  const worksheet = workbook.worksheets[0]
  const transacoes: TransacaoParsed[] = []

  // Detecta a linha de cabeçalho procurando por palavras-chave comuns
  let headerRow = 1
  let colData = 0, colDescricao = 0, colValor = 0, colTipo = 0, colDebito = 0, colCredito = 0

  // 1) Encontra a linha de cabeçalho (a primeira, nas 20 iniciais, que contém uma célula "data")
  let headerValues: (string | number | Date | null)[] | null = null
  worksheet.eachRow((row, rowNum) => {
    if (rowNum > 20 || headerValues) return
    const values = row.values as (string | number | Date | null)[]
    const temData = values.some((c) => ['data', 'date', 'dt'].includes(String(c ?? '').toLowerCase().trim()))
    if (temData) { headerRow = rowNum; headerValues = values }
  })

  // 2) Mapeia as colunas usando SOMENTE a linha de cabeçalho (evita confundir com
  //    valores das linhas de dados, ex: coluna "Tipo" com "debito"/"credito")
  if (headerValues) {
    ;(headerValues as (string | number | Date | null)[]).forEach((cell, colIdx) => {
      const val = String(cell ?? '').toLowerCase().trim()
      if (['data', 'date', 'dt'].includes(val)) colData = colIdx
      if (['histórico', 'descricao', 'descrição', 'description', 'memo'].includes(val)) colDescricao = colIdx
      if (['valor', 'value', 'amount', 'vlr'].includes(val)) colValor = colIdx
      if (['tipo', 'type', 'natureza'].includes(val)) colTipo = colIdx
      if (['débito', 'debito', 'saída', 'saida'].includes(val)) colDebito = colIdx
      if (['crédito', 'credito', 'entrada'].includes(val)) colCredito = colIdx
    })
  }

  worksheet.eachRow((row, rowNum) => {
    if (rowNum <= headerRow) return

    const values = row.values as (string | number | Date | null | ExcelJS.CellValue)[]

    const rawData = colData ? values[colData] : null
    const rawDescricao = colDescricao ? values[colDescricao] : null
    const rawValor = colValor ? values[colValor] : null
    const rawTipo = colTipo ? values[colTipo] : null
    const rawDebito = colDebito ? values[colDebito] : null
    const rawCredito = colCredito ? values[colCredito] : null

    if (!rawData || !rawDescricao) return

    let data: string
    if (rawData instanceof Date) {
      data = rawData.toISOString().split('T')[0]
    } else {
      const parsed = new Date(String(rawData))
      if (isNaN(parsed.getTime())) return
      data = parsed.toISOString().split('T')[0]
    }

    const descricao = String(rawDescricao).trim()

    let valor = 0
    let tipo: 'credito' | 'debito' = 'debito'

    if (colDebito && colCredito) {
      const debitoVal = parseFloat(String(rawDebito ?? '0').replace(',', '.')) || 0
      const creditoVal = parseFloat(String(rawCredito ?? '0').replace(',', '.')) || 0
      if (creditoVal > 0) { valor = creditoVal; tipo = 'credito' }
      else { valor = debitoVal; tipo = 'debito' }
    } else if (rawValor !== null) {
      const numVal = parseFloat(String(rawValor).replace(',', '.'))
      valor = Math.abs(numVal)
      if (rawTipo) {
        const tipoStr = String(rawTipo).toLowerCase()
        tipo = tipoStr.includes('c') ? 'credito' : 'debito'
      } else {
        tipo = numVal >= 0 ? 'credito' : 'debito'
      }
    } else {
      return
    }

    if (valor === 0) return

    transacoes.push({ data, descricao, valor, tipo })
  })

  return transacoes
}
