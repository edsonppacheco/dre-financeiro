import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseAdminClient, selectAll } from '@/lib/supabase'
import { contraparte, extrairChave, heuristicaCodigo } from '@/lib/classificador-contabil'

// POST { conta_id } — sugere conta contábil e cliente/fornecedor dos lançamentos
// ainda sem conta, com um grau de confiança (determinístico, pela força do sinal:
// histórico de contraparte + valor próximo + recorrência; depois regra; depois
// heurística; e, para cliente/fornecedor, casamento de nome com os cadastros).
// A confiança combinada é a MENOR entre os sinais presentes.
const round3 = (x: number) => Math.round(x * 1000) / 1000
const normNome = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

type HistDet = { contas: Record<string, number>; clientes: Record<string, number>; fornecedores: Record<string, number>; valores: number[]; meses: Set<string> }
type PessoaIdx = { id: string; nome: string }

function maisFrequente(c: Record<string, number>): { id: string | null; n: number; total: number } {
  let id: string | null = null, n = 0, total = 0
  for (const [k, v] of Object.entries(c)) { total += v; if (v > n) { n = v; id = k } }
  return { id, n, total }
}
const valorProximo = (valor: number, valores: number[]) => valores.some((v) => v > 0 && Math.abs(v - valor) / v <= 0.1)

// Casa o nome da contraparte (normalizado) com um cadastro de cliente/fornecedor.
// Exato → 0.6; um contém o outro → 0.45. Palpite mesmo sem histórico.
function matchNome(cp: string, idx: PessoaIdx[]): { id: string; conf: number } | null {
  if (cp.length < 3) return null
  const exato = idx.find((p) => p.nome === cp)
  if (exato) return { id: exato.id, conf: 0.6 }
  const parcial = idx.find((p) => p.nome.length >= 3 && (p.nome.includes(cp) || cp.includes(p.nome)))
  if (parcial) return { id: parcial.id, conf: 0.45 }
  return null
}

export async function POST(req: NextRequest) {
  try {
    const { conta_id } = await req.json()
    if (!conta_id) return NextResponse.json({ error: 'conta_id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()

    const { data: txs } = await supabase
      .from('transacoes')
      .select('id, descricao, valor, tipo, conta_contabil_id, cliente_id, fornecedor_id')
      .eq('conta_id', conta_id)
      .is('transferencia_id', null)
      .is('conta_contabil_id', null) // só os ainda não classificados
    if (!txs?.length) return NextResponse.json({ classificadas: 0, pessoas: 0 })

    const { data: plano } = await supabase.from('plano_contas').select('id, codigo, tipo')
    const idPorCodigo: Record<string, string> = {}
    for (const p of plano ?? []) idPorCodigo[p.codigo] = p.id

    // Cadastros de clientes/fornecedores, para casar por nome (palpite sem histórico)
    const [{ data: clientesRaw }, { data: fornecedoresRaw }] = await Promise.all([
      supabase.from('clientes').select('id, nome'),
      supabase.from('fornecedores').select('id, nome'),
    ])
    const idxClientes: PessoaIdx[] = (clientesRaw ?? []).map((c) => ({ id: c.id as string, nome: normNome(c.nome as string) }))
    const idxFornecedores: PessoaIdx[] = (fornecedoresRaw ?? []).map((c) => ({ id: c.id as string, nome: normNome(c.nome as string) }))

    // Histórico detalhado por contraparte (de TODOS os lançamentos já atribuídos).
    // Paginado: o teto de 1000 linhas truncaria o histórico em contas grandes.
    const hist = await selectAll<{ descricao: string; data: string; valor: number; conta_contabil_id: string | null; cliente_id: string | null; fornecedor_id: string | null }>(
      () => supabase
        .from('transacoes')
        .select('descricao, data, valor, conta_contabil_id, cliente_id, fornecedor_id')
        .or('conta_contabil_id.not.is.null,cliente_id.not.is.null,fornecedor_id.not.is.null')
    )
    const det: Record<string, HistDet> = {}
    for (const t of hist ?? []) {
      const k = extrairChave(t.descricao)
      const h = (det[k] ??= { contas: {}, clientes: {}, fornecedores: {}, valores: [], meses: new Set() })
      if (t.conta_contabil_id) h.contas[t.conta_contabil_id as string] = (h.contas[t.conta_contabil_id as string] ?? 0) + 1
      if (t.cliente_id) h.clientes[t.cliente_id as string] = (h.clientes[t.cliente_id as string] ?? 0) + 1
      if (t.fornecedor_id) h.fornecedores[t.fornecedor_id as string] = (h.fornecedores[t.fornecedor_id as string] ?? 0) + 1
      h.valores.push(Number(t.valor)); h.meses.add((t.data as string).slice(0, 7))
    }

    // Regras persistidas (complementam o histórico)
    const chaves = Array.from(new Set(txs.map((t) => extrairChave(t.descricao))))
    const regras: Record<string, string> = {}
    try { const { data } = await supabase.from('regras_classificacao').select('chave, conta_contabil_id').in('chave', chaves); for (const r of data ?? []) regras[r.chave] = r.conta_contabil_id } catch {}
    const regrasPessoa: Record<string, { cliente_id: string | null; fornecedor_id: string | null }> = {}
    try { const { data } = await supabase.from('regras_pessoa').select('chave, cliente_id, fornecedor_id').in('chave', chaves); for (const r of data ?? []) regrasPessoa[r.chave] = { cliente_id: r.cliente_id, fornecedor_id: r.fornecedor_id } } catch {}

    let classificadas = 0, pessoas = 0
    for (const t of txs) {
      const chave = extrairChave(t.descricao)
      const h = det[chave]
      const valor = Number(t.valor)

      // ---- Conta contábil ----
      let contaId: string | null = null, contaConf = 0
      const hc = h ? maisFrequente(h.contas) : { id: null, n: 0, total: 0 }
      if (hc.id) {
        contaId = hc.id
        contaConf = 0.7 + 0.2 * (hc.n / hc.total) // consistência da contraparte
        if (valorProximo(valor, h!.valores)) contaConf += 0.06
        if (h!.meses.size >= 3) contaConf += 0.04
      } else if (regras[chave]) { contaId = regras[chave]; contaConf = 0.85 }
      else { const cod = heuristicaCodigo(t.descricao, t.tipo); if (cod && idPorCodigo[cod]) { contaId = idPorCodigo[cod]; contaConf = 0.55 } }
      if (contaId) contaConf = Math.min(0.99, contaConf)

      // ---- Cliente / Fornecedor ----
      let clienteId: string | null = null, fornecedorId: string | null = null, pessoaConf: number | null = null
      const hCli = h ? maisFrequente(h.clientes) : { id: null, n: 0, total: 0 }
      const hFor = h ? maisFrequente(h.fornecedores) : { id: null, n: 0, total: 0 }
      if (hCli.id || hFor.id) {
        if ((hCli.n ?? 0) >= (hFor.n ?? 0) && hCli.id) { clienteId = hCli.id; pessoaConf = 0.7 + 0.25 * (hCli.n / (hCli.total || 1)) }
        else if (hFor.id) { fornecedorId = hFor.id; pessoaConf = 0.7 + 0.25 * (hFor.n / (hFor.total || 1)) }
      } else if (regrasPessoa[chave]) {
        const rp = regrasPessoa[chave]
        if (rp.cliente_id) { clienteId = rp.cliente_id; pessoaConf = 0.85 }
        else if (rp.fornecedor_id) { fornecedorId = rp.fornecedor_id; pessoaConf = 0.85 }
      }
      // Fallback: casa o nome da contraparte com os cadastros (palpite mesmo sem
      // histórico). Crédito tende a cliente; débito tende a fornecedor — mas tenta
      // os dois. Melhor uma sugestão de ~45-60% para revisão do que deixar vazio.
      if (!clienteId && !fornecedorId) {
        const cpNorm = normNome(contraparte(t.descricao))
        const ordem: ['cliente' | 'fornecedor', PessoaIdx[]][] = t.tipo === 'credito'
          ? [['cliente', idxClientes], ['fornecedor', idxFornecedores]]
          : [['fornecedor', idxFornecedores], ['cliente', idxClientes]]
        for (const [tipoP, idx] of ordem) {
          const m = matchNome(cpNorm, idx)
          if (m) { if (tipoP === 'cliente') clienteId = m.id; else fornecedorId = m.id; pessoaConf = m.conf; break }
        }
      }
      if (pessoaConf !== null) pessoaConf = Math.min(0.99, pessoaConf)

      // Sem nenhum sinal (nem conta nem pessoa): deixa para o usuário
      if (!contaId && !clienteId && !fornecedorId) continue

      // Confiança combinada = a MENOR entre os sinais presentes
      const confs = [contaId ? contaConf : null, pessoaConf].filter((x): x is number => x !== null)
      const confianca = confs.length ? Math.min(...confs) : 0.4

      const update: Record<string, unknown> = { confianca: round3(confianca) }
      if (contaId) update.conta_contabil_id = contaId
      if (clienteId) { update.cliente_id = clienteId; pessoas++ }
      else if (fornecedorId) { update.fornecedor_id = fornecedorId; pessoas++ }
      await supabase.from('transacoes').update(update).eq('id', t.id)
      classificadas++
    }

    return NextResponse.json({ classificadas, pessoas })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
