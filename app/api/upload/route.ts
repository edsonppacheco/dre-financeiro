import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { parseExcel } from '@/lib/parsers/excel'
import { parsePDF } from '@/lib/parsers/pdf'

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const contaId = formData.get('conta_id') as string
    const mesReferencia = formData.get('mes_referencia') as string

    if (!files.length || !contaId || !mesReferencia) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const resultados = []

    for (const file of files) {
      const buffer = await file.arrayBuffer()
      const ext = file.name.split('.').pop()?.toLowerCase()

      // Upload para Vercel Blob
      const blob = await put(`extratos/${contaId}/${mesReferencia}/${file.name}`, buffer, {
        access: 'private',
        contentType: file.type,
      })

      // Cria registro do extrato
      const { data: extrato, error: extratoErr } = await supabase
        .from('extratos')
        .insert({ conta_id: contaId, mes_referencia: `${mesReferencia}-01`, arquivo_url: blob.url, status: 'processando' })
        .select()
        .single()

      if (extratoErr || !extrato) {
        resultados.push({ arquivo: file.name, erro: extratoErr?.message ?? 'Erro ao criar extrato' })
        continue
      }

      // Parseia o arquivo
      let transacoes: { data: string; descricao: string; valor: number; tipo: string }[] = []
      let saldoInicial: number | null = null
      let saldosDia: { data: string; saldo: number }[] = []
      try {
        if (ext === 'pdf') {
          const r = await parsePDF(buffer)
          transacoes = r.transacoes
          saldoInicial = r.saldoInicial
          saldosDia = r.saldosDia
        } else if (['xlsx', 'xls'].includes(ext ?? '')) {
          transacoes = await parseExcel(buffer)
        } else {
          throw new Error('Formato não suportado. Use PDF ou Excel.')
        }
      } catch (parseErr: unknown) {
        await supabase.from('extratos').update({ status: 'erro' }).eq('id', extrato.id)
        resultados.push({ arquivo: file.name, erro: parseErr instanceof Error ? parseErr.message : 'Erro no parse' })
        continue
      }

      // Insere transações (com conta_id, para aparecerem no extrato da conta)
      if (transacoes.length > 0) {
        const { error: txErr } = await supabase.from('transacoes').insert(
          transacoes.map((t) => ({ ...t, extrato_id: extrato.id, conta_id: contaId }))
        )
        if (txErr) {
          await supabase.from('extratos').update({ status: 'erro' }).eq('id', extrato.id)
          resultados.push({ arquivo: file.name, erro: txErr.message })
          continue
        }
      }

      // PDF: grava saldo inicial (1º extrato) e saldos diários do documento.
      // Em try/catch para não falhar o upload caso a migração de saldo ainda não exista.
      if (ext === 'pdf') {
        try {
          if (saldoInicial !== null) {
            await supabase.from('contas').update({ saldo_inicial: saldoInicial }).eq('id', contaId).eq('saldo_inicial', 0)
          }
          if (saldosDia.length > 0) {
            await supabase.from('saldos_extrato').insert(
              saldosDia.map((s) => ({ extrato_id: extrato.id, conta_id: contaId, data: s.data, saldo: s.saldo }))
            )
          }
        } catch { /* ignora: feature de saldo depende de migração */ }
      }

      await supabase.from('extratos').update({ status: 'processado' }).eq('id', extrato.id)
      resultados.push({ arquivo: file.name, extrato_id: extrato.id, transacoes: transacoes.length })
    }

    return NextResponse.json({ resultados })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
