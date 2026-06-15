import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { excelParaTexto } from '@/lib/parsers/excel'
import { parsePDF, parseTextoExtrato } from '@/lib/parsers/pdf'

// Extração por IA de extratos grandes pode demorar; amplia o limite de duração.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const files = formData.getAll('files') as File[]
    const contaId = formData.get('conta_id') as string
    // Período é detectado pelas datas do próprio extrato (definido após o parse).
    const hojeMes = new Date().toISOString().slice(0, 7)

    if (!files.length || !contaId) {
      return NextResponse.json({ error: 'Campos obrigatórios ausentes' }, { status: 400 })
    }

    const supabase = createSupabaseAdminClient()
    const resultados = []

    for (const file of files) {
      const buffer = await file.arrayBuffer()
      const ext = file.name.split('.').pop()?.toLowerCase()

      // Upload para Vercel Blob (addRandomSuffix evita conflito ao reenviar o mesmo arquivo)
      const blob = await put(`extratos/${contaId}/${hojeMes}/${file.name}`, buffer, {
        access: 'private',
        contentType: file.type,
        addRandomSuffix: true,
      })

      // Cria registro do extrato (mes_referencia provisório; ajustado após o parse)
      const { data: extrato, error: extratoErr } = await supabase
        .from('extratos')
        .insert({ conta_id: contaId, mes_referencia: `${hojeMes}-01`, arquivo_url: blob.url, status: 'processando' })
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
          const r = await parseTextoExtrato(await excelParaTexto(buffer))
          transacoes = r.transacoes
          saldoInicial = r.saldoInicial
          saldosDia = r.saldosDia
        } else {
          throw new Error('Formato não suportado. Use PDF ou Excel.')
        }
      } catch (parseErr: unknown) {
        await supabase.from('extratos').update({ status: 'erro' }).eq('id', extrato.id)
        resultados.push({ arquivo: file.name, erro: parseErr instanceof Error ? parseErr.message : 'Erro no parse' })
        continue
      }

      // ── Filtragem de datas já importadas ─────────────────────────────────────
      // Usa datas distintas em saldos_extrato para identificar o que já existe,
      // evitando inflação de contagem por duplicatas anteriores no banco.
      // Em vez de rejeitar o arquivo inteiro, importa apenas as datas novas
      // (ex: arquivo Jan–Mar onde Jan e Fev já existem → importa só Março).
      let transacoesParaImportar = transacoes
      let saldosDiaParaImportar = saldosDia
      const datasDoArquivo = [...new Set([...transacoes.map((t) => t.data), ...saldosDia.map((s) => s.data)])]

      if (datasDoArquivo.length > 0) {
        const { data: jaExistem } = await supabase
          .from('saldos_extrato')
          .select('data')
          .eq('conta_id', contaId)
          .in('data', datasDoArquivo)
        const datasExistentes = new Set(jaExistem?.map((e) => e.data) ?? [])

        if (datasExistentes.size > 0) {
          transacoesParaImportar = transacoes.filter((t) => !datasExistentes.has(t.data))
          saldosDiaParaImportar = saldosDia.filter((s) => !datasExistentes.has(s.data))

          if (transacoesParaImportar.length === 0 && transacoes.length > 0) {
            await supabase.from('extratos').update({ status: 'duplicado' }).eq('id', extrato.id)
            resultados.push({
              arquivo: file.name,
              aviso: 'duplicado',
              mensagem: `Extrato já importado — todas as datas já existem nesta conta.`,
            })
            continue
          }
        }
      }

      const ignoradas = transacoes.length - transacoesParaImportar.length

      // Insere transações (com conta_id, para aparecerem no extrato da conta)
      if (transacoesParaImportar.length > 0) {
        const { error: txErr } = await supabase.from('transacoes').insert(
          transacoesParaImportar.map((t) => ({ ...t, extrato_id: extrato.id, conta_id: contaId }))
        )
        if (txErr) {
          await supabase.from('extratos').update({ status: 'erro' }).eq('id', extrato.id)
          resultados.push({ arquivo: file.name, erro: txErr.message })
          continue
        }
      }

      // Saldo inicial (1º extrato) e saldos diários do documento (PDF e Excel).
      // Em try/catch para não falhar o upload caso a migração de saldo ainda não exista.
      try {
        if (saldoInicial !== null) {
          await supabase.from('contas').update({ saldo_inicial: saldoInicial }).eq('id', contaId).eq('saldo_inicial', 0)
        }
        if (saldosDiaParaImportar.length > 0) {
          await supabase.from('saldos_extrato').insert(
            saldosDiaParaImportar.map((s) => ({ extrato_id: extrato.id, conta_id: contaId, data: s.data, saldo: s.saldo }))
          )
        }
      } catch { /* ignora: feature de saldo depende de migração */ }

      // ── Conciliação: saldo calculado pelas transações vs saldo do extrato ──
      // Compara o saldo acumulado (saldo_inicial + movimentos) com os saldos
      // informados pelo banco para cada dia do período importado.
      const conciliacao: { data: string; saldo_calculado: number; saldo_extrato: number; diferenca: number }[] = []
      if (saldosDiaParaImportar.length > 0) {
        const dataFim = [...saldosDiaParaImportar].sort((a, b) => a.data.localeCompare(b.data)).at(-1)!.data
        const [{ data: contaDados }, { data: todasTxs }] = await Promise.all([
          supabase.from('contas').select('saldo_inicial').eq('id', contaId).single(),
          supabase.from('transacoes').select('data, valor, tipo').eq('conta_id', contaId).lte('data', dataFim).order('data'),
        ])
        if (todasTxs) {
          let saldoAcum = Number(contaDados?.saldo_inicial ?? 0)
          const saldoCalcPorDia: Record<string, number> = {}
          for (const t of todasTxs) {
            saldoAcum = Math.round((saldoAcum + (t.tipo === 'credito' ? Number(t.valor) : -Number(t.valor))) * 100) / 100
            saldoCalcPorDia[t.data] = saldoAcum
          }
          for (const { data, saldo } of saldosDiaParaImportar) {
            const calc = saldoCalcPorDia[data]
            if (calc !== undefined) {
              const diferenca = Math.round((calc - Number(saldo)) * 100) / 100
              if (Math.abs(diferenca) >= 0.01) conciliacao.push({ data, saldo_calculado: calc, saldo_extrato: Number(saldo), diferenca })
            }
          }
        }
      }

      // Período detectado pelas datas das transações novas (substitui o mês de referência manual)
      const datas = transacoesParaImportar.map((t) => t.data).sort()
      const periodo = datas.length
        ? { data_inicio: datas[0], data_fim: datas[datas.length - 1], mes_referencia: `${datas[0].slice(0, 7)}-01` }
        : {}
      await supabase.from('extratos').update({ status: 'processado', ...periodo }).eq('id', extrato.id)
      resultados.push({
        arquivo: file.name,
        extrato_id: extrato.id,
        transacoes: transacoesParaImportar.length,
        ...(ignoradas > 0 ? { ignoradas } : {}),
        ...(conciliacao.length > 0 ? { conciliacao } : {}),
      })
    }

    return NextResponse.json({ resultados })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Erro interno'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
