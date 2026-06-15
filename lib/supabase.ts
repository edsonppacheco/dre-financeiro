import { createClient, SupabaseClient } from '@supabase/supabase-js'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

export type Conta = { id: string; nome: string; banco: string; tipo: 'corrente' | 'cartao'; created_at: string }
export type PlanoConta = { id: string; codigo: string; nome: string; tipo: string; pai_id: string | null; ordem: number; created_at: string }
export type Cliente = { id: string; nome: string; cnpj: string | null; email: string | null; telefone: string | null; endereco: string | null; razao_social: string | null; created_at: string }
export type Fornecedor = Omit<Cliente, never>
export type Extrato = { id: string; conta_id: string; mes_referencia: string; arquivo_url: string; status: string; created_at: string }
export type Transacao = { id: string; extrato_id: string; data: string; descricao: string; valor: number; tipo: string; created_at: string }
export type Classificacao = { id: string; transacao_id: string; linha_dre: string; confianca: number; revisado: boolean; corrigido_para: string | null; created_at: string }
export type LinhaDre = { id: string; codigo: string; nome: string; tipo: string; ordem: number; pai_id: string | null; created_at: string }

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Supabase env vars not configured')
  return { url, anonKey }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getSupabaseClient(): SupabaseClient<any> {
  const { url, anonKey } = getSupabaseConfig()
  return createClient(url, anonKey)
}

export async function createSupabaseServerClient() {
  const { url, anonKey } = getSupabaseConfig()
  const cookieStore = await cookies()
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        cookiesToSet.forEach(({ name, value, options }) => {
          cookieStore.set(name, value, options)
        })
      },
    },
  })
}

/**
 * Busca TODAS as linhas de uma query paginando de 1000 em 1000.
 * O PostgREST limita cada resposta a 1000 linhas por padrão; sem isso, queries
 * de agregação (dashboard, DRE, extrato) silenciosamente truncam o histórico e
 * produzem saldos e totais errados. O callback `build` deve criar uma query NOVA
 * a cada chamada (o .range() finaliza a query).
 */
export async function selectAll<T = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  build: () => any
): Promise<T[]> {
  const pageSize = 1000
  const todas: T[] = []
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await build().range(from, from + pageSize - 1)
    if (error) throw new Error(error.message)
    todas.push(...((data ?? []) as T[]))
    if (!data || data.length < pageSize) break
  }
  return todas
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createSupabaseAdminClient(): SupabaseClient<any> {
  const { url } = getSupabaseConfig()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not configured')
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
