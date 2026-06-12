'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

type UploadResult = {
  arquivo: string
  extrato_id?: string
  transacoes?: number
  erro?: string
}

type Documento = {
  id: string
  mes_referencia: string
  status: string
  created_at: string
  conta_nome: string | null
  conta_banco: string | null
  conta_tipo: string | null
  transacoes: number
}

type UploadState = 'idle' | 'uploading' | 'classificando' | 'done' | 'error'

export default function UploadPage() {
  const router = useRouter()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [files, setFiles] = useState<File[]>([])
  const [contaNome, setContaNome] = useState('')
  const [banco, setBanco] = useState('')
  const [tipoConta, setTipoConta] = useState<'corrente' | 'cartao'>('corrente')
  const [mesReferencia, setMesReferencia] = useState('')
  const [state, setState] = useState<UploadState>('idle')
  const [resultados, setResultados] = useState<UploadResult[]>([])
  const [dragging, setDragging] = useState(false)
  const [documentos, setDocumentos] = useState<Documento[]>([])

  const carregarDocumentos = useCallback(() => {
    fetch('/api/documentos')
      .then((r) => r.json())
      .then((d) => { if (!d.error) setDocumentos(d.documentos) })
      .catch(() => {})
  }, [])

  useEffect(() => { carregarDocumentos() }, [carregarDocumentos])

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return
    const valid = Array.from(newFiles).filter((f) =>
      ['application/pdf', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
       'application/vnd.ms-excel'].includes(f.type) ||
      f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.pdf')
    )
    setFiles((prev) => [...prev, ...valid])
  }, [])

  const removeFile = (idx: number) => setFiles((prev) => prev.filter((_, i) => i !== idx))

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    addFiles(e.dataTransfer.files)
  }, [addFiles])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!files.length || !contaNome || !banco || !mesReferencia) return

    setState('uploading')
    setResultados([])

    try {
      // Cria ou recupera conta (simplificado — em produção seria um select-or-insert)
      const contaRes = await fetch('/api/contas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: contaNome, banco, tipo: tipoConta }),
      })
      const { id: contaId } = await contaRes.json()

      const formData = new FormData()
      formData.append('conta_id', contaId)
      formData.append('mes_referencia', mesReferencia)
      files.forEach((f) => formData.append('files', f))

      const uploadRes = await fetch('/api/upload', { method: 'POST', body: formData })
      const { resultados: res } = await uploadRes.json()
      setResultados(res)

      // Classifica os extratos com sucesso
      const extratosOk = res.filter((r: UploadResult) => r.extrato_id && !r.erro)
      if (extratosOk.length > 0) {
        setState('classificando')
        await Promise.all(
          extratosOk.map((r: UploadResult) =>
            fetch('/api/classificar', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ extrato_id: r.extrato_id }),
            })
          )
        )
      }

      setState('done')
      carregarDocumentos()
    } catch {
      setState('error')
    }
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-800">Upload de Extratos</h1>
        <p className="text-slate-500 mt-1">Envie arquivos PDF ou Excel para classificação automática com IA</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Dados da conta */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="font-semibold text-slate-700">Dados da conta</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Nome da conta</label>
              <input
                type="text"
                value={contaNome}
                onChange={(e) => setContaNome(e.target.value)}
                placeholder="Ex: Conta Corrente Principal"
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">Banco</label>
              <input
                type="text"
                value={banco}
                onChange={(e) => setBanco(e.target.value)}
                placeholder="Ex: Bradesco"
                required
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Tipo de conta</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTipoConta('corrente')}
                className={`flex-1 text-sm py-2 rounded-lg border font-medium transition-colors ${tipoConta === 'corrente' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
              >
                🏦 Conta corrente
              </button>
              <button
                type="button"
                onClick={() => setTipoConta('cartao')}
                className={`flex-1 text-sm py-2 rounded-lg border font-medium transition-colors ${tipoConta === 'cartao' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}
              >
                💳 Cartão de crédito
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">Mês de referência</label>
            <input
              type="month"
              value={mesReferencia}
              onChange={(e) => setMesReferencia(e.target.value)}
              required
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
          </div>
        </div>

        {/* Área de drop */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
            dragging ? 'border-slate-500 bg-slate-50' : 'border-slate-300 hover:border-slate-400 hover:bg-slate-50'
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.xlsx,.xls"
            onChange={(e) => addFiles(e.target.files)}
            className="hidden"
          />
          <div className="text-4xl mb-3">📂</div>
          <p className="font-medium text-slate-700">Arraste arquivos aqui ou clique para selecionar</p>
          <p className="text-sm text-slate-400 mt-1">PDF ou Excel (.xlsx, .xls) — múltiplos arquivos permitidos</p>
        </div>

        {/* Lista de arquivos selecionados */}
        {files.length > 0 && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">{files.length} arquivo(s) selecionado(s)</span>
              <button type="button" onClick={() => setFiles([])} className="text-xs text-red-500 hover:underline">
                Remover todos
              </button>
            </div>
            <ul className="divide-y divide-slate-100">
              {files.map((file, idx) => (
                <li key={idx} className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{file.name.endsWith('.pdf') ? '📄' : '📊'}</span>
                    <div>
                      <p className="text-sm font-medium text-slate-700 truncate max-w-xs">{file.name}</p>
                      <p className="text-xs text-slate-400">{formatSize(file.size)}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(idx)}
                    className="text-slate-400 hover:text-red-500 transition-colors text-lg leading-none"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Botão de envio */}
        <button
          type="submit"
          disabled={state === 'uploading' || state === 'classificando' || !files.length}
          className="w-full bg-slate-800 text-white py-3 rounded-xl font-semibold text-sm hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {state === 'uploading' && 'Enviando e processando...'}
          {state === 'classificando' && 'Classificando com IA...'}
          {(state === 'idle' || state === 'done' || state === 'error') && 'Enviar e Classificar'}
        </button>
      </form>

      {/* Resultados */}
      {resultados.length > 0 && (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="font-semibold text-slate-700">Resultado do processamento</h3>
          </div>
          <ul className="divide-y divide-slate-100">
            {resultados.map((r, idx) => (
              <li key={idx} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-700">{r.arquivo}</p>
                  {r.erro ? (
                    <p className="text-xs text-red-500">{r.erro}</p>
                  ) : (
                    <p className="text-xs text-slate-400">{r.transacoes} transação(ões) extraída(s)</p>
                  )}
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${r.erro ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-700'}`}>
                  {r.erro ? 'Erro' : 'OK'}
                </span>
              </li>
            ))}
          </ul>
          {state === 'done' && resultados.some((r) => !r.erro) && (
            <div className="px-4 py-4 bg-slate-50 border-t border-slate-100">
              <button
                onClick={() => router.push('/revisao')}
                className="w-full bg-green-600 text-white py-2.5 rounded-lg font-semibold text-sm hover:bg-green-700 transition-colors"
              >
                Revisar classificações →
              </button>
            </div>
          )}
        </div>
      )}

      {/* Registro de documentos enviados */}
      {documentos.length > 0 && (
        <div className="mt-8">
          <h3 className="font-semibold text-slate-700 mb-3">Documentos enviados</h3>
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
            {documentos.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-lg">{d.conta_tipo === 'cartao' ? '💳' : '🏦'}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700 truncate">
                    {d.conta_nome ?? 'Conta'} <span className="text-slate-400 font-normal">· {d.conta_banco}</span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {d.mes_referencia?.slice(0, 7)} · {d.transacoes} transação(ões)
                  </p>
                </div>
                <span className={`text-xs font-medium px-2 py-1 rounded-full ${
                  d.status === 'processado' ? 'bg-green-100 text-green-700'
                  : d.status === 'erro' ? 'bg-red-100 text-red-600'
                  : 'bg-amber-100 text-amber-700'
                }`}>
                  {d.status}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
