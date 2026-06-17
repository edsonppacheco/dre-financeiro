import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createSupabaseAdminClient } from '@/lib/supabase'
import { excelParaTexto } from '@/lib/parsers/excel'
import { parsePDF, parseTextoExtrato } from '@/lib/parsers/pdf'
import { ehArquivoQBO, parseQBO, mapearCategoriaQBO } from '@/lib/parsers/qbo'
import { ehImagem, parseExtratoImagens } from '@/lib/parsers/imagem'

// Extração por IA (texto ou visão) de extratos grandes pode demorar.
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

    // Cada documento (PDF/Excel/CSV) é um extrato. TODAS as imagens enviadas
    // juntas são tratadas como UM extrato só (prints do mesmo extrato), que a IA
    // monta unindo os prints e removendo sobreposições.
    type Unidade = { nome: string; arquivos: File[]; ehImagem: boolean }
    const imagens = files.filter((f) => ehImagem(f.name, f.type))
    const docs = files.filter((f) => !ehImagem(f.name, f.type))
    const unidades: Unidade[] = docs.map((f) => ({ nome: f.name, arquivos: [f], ehImagem: false }))
    if (imagens.length) {
      const nome = imagens.length > 1 ? `${imagens[0].name} +${imagens.length - 1} print(s)` : imagens[0].name
      unidades.push({ nome, arquivos: imagens, ehImagem: true })
    }

    for (const unidade of unidades) {
      const nome = unidade.nome

      // Sobe cada arquivo da unidade ao Blob; guarda os buffers para o parse.
      const arquivosBuf: { buffer: ArrayBuffer; nome: string; mime: string }[] = []
      let arquivoUrl = ''
      for (const f of unidade.arquivos) {
        const buffer = await f.arrayBuffer()
        arquivosBuf.push({ buffer, nome: f.name, mime: f.type })
        const blob = await put(`extratos/${contaId}/${hojeMes}/${f.name}`, buffer, {
          access: 'private', contentType: f.type, addRandomSuffix: true,
        })
        if (!arquivoUrl) arquivoUrl = blob.url
      }

      // Cria registro do extrato (mes_referencia provisório; ajustado após o parse)
      const { data: extrato, error: extratoErr } = await supabase
        .from('extratos')
        .insert({ conta_id: contaId, mes_referencia: `${hojeMes}-01`, arquivo_url: arquivoUrl, status: 'processando' })
        .select()
        .single()

      if (extratoErr || !extrato) {
        resultados.push({ arquivo: nome, erro: extratoErr?.message ?? 'Erro ao criar extrato' })
        continue
      }

      // Parseia. transacoes pode carregar conta_contabil_id/confianca quando a
      // fonte já traz a categoria (ex: coluna Account do QuickBooks).
      let transacoes: { data: string; descricao: string; valor: number; tipo: string; conta_contabil_id?: string | null; confianca?: number }[] = []
      let saldoInicial: number | null = null
      let saldosDia: { data: string; saldo: number }[] = []
      // QBO traz o saldo corrente em cada linha → saldo inicial autoritativo.
      let saldoInicialAutoritativo = false
      try {
        if (unidade.ehImagem) {
          const r = await parseExtratoImagens(arquivosBuf)
          transacoes = r.transacoes
          saldoInicial = r.saldoInicial
          saldosDia = r.saldosDia
        } else {
          const { buffer } = arquivosBuf[0]
          const ext = nome.split('.').pop()?.toLowerCase()
          if (ext === 'pdf') {
            const r = await parsePDF(buffer)
            transacoes = r.transacoes
            saldoInicial = r.saldoInicial
            saldosDia = r.saldosDia
          } else if (['xlsx', 'xls', 'csv'].includes(ext ?? '') && ehArquivoQBO(buffer)) {
            // QuickBooks Account Register: parser determinístico, sinais explícitos.
            const r = parseQBO(buffer)
            saldoInicial = r.saldoInicial
            saldosDia = r.saldosDia
            saldoInicialAutoritativo = true
            const { data: plano } = await supabase.from('plano_contas').select('id, codigo')
            const idPorCodigo: Record<string, string> = {}
            for (const p of plano ?? []) idPorCodigo[p.codigo] = p.id
            transacoes = r.transacoes.map((t) => {
              const codigo = mapearCategoriaQBO(t.categoriaQBO, t.tipo)
              const ccId = codigo ? idPorCodigo[codigo] : undefined
              return {
                data: t.data, descricao: t.descricao, valor: t.valor, tipo: t.tipo,
                ...(ccId ? { conta_contabil_id: ccId, confianca: 0.5 } : {}),
              }
            })
          } else if (['xlsx', 'xls'].includes(ext ?? '')) {
            const r = await parseTextoExtrato(await excelParaTexto(buffer))
            transacoes = r.transacoes
            saldoInicial = r.saldoInicial
            saldosDia = r.saldosDia
          } else {
            throw new Error('Formato não suportado. Use PDF, Excel, CSV ou imagem (print).')
          }
        }
      } catch (parseErr: unknown) {
        await supabase.from('extratos').update({ status: 'erro' }).eq('id', extrato.id)
        resultados.push({ arquivo: nome, erro: parseErr instanceof Error ? parseErr.message : 'Erro no parse' })
        continue
      }

      // A conta já tinha lançamentos antes deste upload? Define se o saldo
      // inicial (abertura de TODO o histórico) ainda pode ser estabelecido por
      // este arquivo. Statements de sub-período (ex: PDF/print mensal) não devem
      // sobrescrever a abertura já existente com a abertura do seu período.
      const { count: txExistentesConta } = await supabase
        .from('transacoes').select('id', { count: 'exact', head: true }).eq('conta_id', contaId)
      const contaJaTinhaTransacoes = (txExistentesConta ?? 0) > 0

      // ── Deduplicação em nível de TRANSAÇÃO (não de data) ─────────────────────
      // A chave é (data, descrição, valor, tipo) com contagem (multiset): se o
      // banco tem N cópias de uma chave, pulamos só N do arquivo, preservando
      // lançamentos legítimos idênticos no mesmo dia.
      let transacoesParaImportar = transacoes
      let saldosDiaParaImportar = saldosDia
      const datasDoArquivo = [...transacoes.map((t) => t.data), ...saldosDia.map((s) => s.data)].sort()

      if (datasDoArquivo.length > 0) {
        const dataMin = datasDoArquivo[0]
        const dataMax = datasDoArquivo[datasDoArquivo.length - 1]
        const [{ data: txExistentes }, { data: saldosExistentes }] = await Promise.all([
          supabase.from('transacoes').select('data, descricao, valor, tipo').eq('conta_id', contaId).gte('data', dataMin).lte('data', dataMax),
          supabase.from('saldos_extrato').select('data').eq('conta_id', contaId).gte('data', dataMin).lte('data', dataMax),
        ])

        const chaveTx = (t: { data: string; descricao: string; valor: number; tipo: string }) =>
          `${t.data}|${t.descricao}|${Number(t.valor).toFixed(2)}|${t.tipo}`
        const contagemExistente: Record<string, number> = {}
        for (const t of txExistentes ?? []) {
          const k = chaveTx(t as { data: string; descricao: string; valor: number; tipo: string })
          contagemExistente[k] = (contagemExistente[k] ?? 0) + 1
        }
        transacoesParaImportar = []
        for (const t of transacoes) {
          const k = chaveTx(t)
          if ((contagemExistente[k] ?? 0) > 0) { contagemExistente[k]--; continue }
          transacoesParaImportar.push(t)
        }

        const datasComSaldos = new Set(saldosExistentes?.map((e) => e.data) ?? [])
        saldosDiaParaImportar = saldosDia.filter((s) => !datasComSaldos.has(s.data))

        if (transacoesParaImportar.length === 0 && transacoes.length > 0) {
          await supabase.from('extratos').update({ status: 'duplicado' }).eq('id', extrato.id)
          const datasUnicas = [...new Set(transacoes.map((t) => t.data))].sort()
          resultados.push({
            arquivo: nome,
            aviso: 'duplicado',
            mensagem: `Extrato já importado — ${transacoes.length} transações extraídas (${datasUnicas[0]} a ${datasUnicas.at(-1)}), todas já existem nesta conta.`,
          })
          continue
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
          resultados.push({ arquivo: nome, erro: txErr.message })
          continue
        }
      }

      // Saldo inicial e saldos diários do documento.
      try {
        // Só define o saldo inicial (abertura de TODO o histórico) quando:
        //  - QBO (autoritativo: o saldo corrente do documento é a fonte da verdade), ou
        //  - a conta ainda não tinha nenhum lançamento (este é o 1º import).
        if (saldoInicial !== null && (saldoInicialAutoritativo || !contaJaTinhaTransacoes)) {
          await supabase.from('contas').update({ saldo_inicial: saldoInicial }).eq('id', contaId)
        }
        if (saldosDiaParaImportar.length > 0) {
          await supabase.from('saldos_extrato').insert(
            saldosDiaParaImportar.map((s) => ({ extrato_id: extrato.id, conta_id: contaId, data: s.data, saldo: s.saldo }))
          )
        }
      } catch { /* ignora: feature de saldo depende de migração */ }

      // ── Conciliação: saldo calculado pelas transações vs saldo do extrato ──
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

      // Período detectado pelas datas das transações novas
      const datas = transacoesParaImportar.map((t) => t.data).sort()
      const periodo = datas.length
        ? { data_inicio: datas[0], data_fim: datas[datas.length - 1], mes_referencia: `${datas[0].slice(0, 7)}-01` }
        : {}
      await supabase.from('extratos').update({ status: 'processado', ...periodo }).eq('id', extrato.id)
      resultados.push({
        arquivo: nome,
        extrato_id: extrato.id,
        transacoes: transacoesParaImportar.length,
        ...(unidade.ehImagem ? { prints: unidade.arquivos.length } : {}),
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
