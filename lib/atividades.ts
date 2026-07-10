import type { SupabaseClient } from '@supabase/supabase-js'

export type Atividade = {
  acao: string
  entidade?: string
  entidade_id?: string | null
  descricao: string
  dados?: Record<string, unknown>
}

/**
 * Registra uma atividade no log. Nunca lança: uma falha no log (ex: tabela
 * ainda não migrada) não pode quebrar a operação principal.
 */
export async function registrarAtividade(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  a: Atividade
): Promise<void> {
  try {
    await supabase.from('atividades').insert({
      acao: a.acao,
      entidade: a.entidade ?? null,
      entidade_id: a.entidade_id ?? null,
      descricao: a.descricao,
      dados: a.dados ?? null,
    })
  } catch { /* log é best-effort */ }
}
