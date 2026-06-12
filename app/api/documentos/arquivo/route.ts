import { NextRequest, NextResponse } from 'next/server'
import { get } from '@vercel/blob'
import { createSupabaseAdminClient } from '@/lib/supabase'

// GET /api/documentos/arquivo?id=<extrato_id> — faz proxy do arquivo do extrato
// (blob privado), transmitindo o conteúdo autenticado pelo token do servidor.
export async function GET(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id obrigatório' }, { status: 400 })

    const supabase = createSupabaseAdminClient()
    const { data, error } = await supabase.from('extratos').select('arquivo_url').eq('id', id).single()
    if (error || !data?.arquivo_url) return NextResponse.json({ error: 'arquivo não encontrado' }, { status: 404 })

    const result = await get(data.arquivo_url, { access: 'private' })
    if (!result || result.statusCode !== 200 || !result.stream) {
      return NextResponse.json({ error: 'falha ao ler o arquivo' }, { status: 502 })
    }

    return new Response(result.stream, {
      headers: {
        'Content-Type': result.blob.contentType || 'application/octet-stream',
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=60',
      },
    })
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Erro interno' }, { status: 500 })
  }
}
