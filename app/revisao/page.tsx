'use client'

import { useEffect, useMemo, useState } from 'react'

type Item = {
  id: string
  linha_dre: string
  confianca: number
  revisado: boolean
  corrigido_para: string | null
  transacao_id: string
  data: string
  descricao: string
  valor: number
  tipo: string
  mes_referencia: string
  conta_nome: string | null
  conta_banco: string | null
}

type Linha = { codigo: string; nome: string; tipo: string }

type Filtro = 'todas' | 'pendentes' | 'baixa_confianca'

export default function RevisaoPage() {
  const [itens, setItens] = useState<Item[]>([])
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [filtro, setFiltro] = useState<Filtro>('todas')
  const [salvando, setSalvando] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/revisao')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setItens(d.itens)
        setLinhas(d.linhas)
      })
      .catch((e) => setErro(e.message))
      .finally(() => setLoading(false))
  }, [])

  const linhaMap = useMemo(() => {
    const m = new Map<string, Linha>()
    linhas.forEach((l) => m.set(l.codigo, l))
    return m
  }, [linhas])

  const stats = useMemo(() => {
    const total = itens.length
    const revisadas = itens.filter((i) => i.revisado).length
    const baixa = itens.filter((i) => i.confianca < 0.7).length
    return { total, revisadas, pendentes: total - revisadas, baixa }
  }, [itens])

  const visiveis = useMemo(() => {
    if (filtro === 'pendentes') return itens.filter((i) => !i.revisado)
    if (filtro === 'baixa_confianca') return itens.filter((i) => i.confianca < 0.7)
    return itens
  }, [itens, filtro])

  const patch = async (id: string, body: { corrigido_para?: string | null; revisado?: boolean }) => {
    setSalvando((s) => new Set(s).add(id))
    try {
      const res = await fetch('/api/revisao', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...body }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setItens((prev) =>
        prev.map((i) =>
          i.id === id
            ? { ...i, ...('corrigido_para' in body ? { corrigido_para: body.corrigido_para ?? null } : {}), ...('revisado' in body ? { revisado: body.revisado! } : {}) }
            : i
        )
      )
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSalvando((s) => {
        const n = new Set(s)
        n.delete(id)
        return n
      })
    }
  }

  // Corrigir implica revisar
  const handleCorrigir = (item: Item, codigo: string) => {
    const corrigido = codigo === item.linha_dre ? null : codigo
    patch(item.id, { corrigido_para: corrigido, revisado: true })
  }

  const fmtMoeda = (v: number) =>
    v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

  const fmtData = (d: string) => {
    const [, m, dia] = d.split('-')
    return `${dia}/${m}`
  }

  const linhaLabel = (codigo: string) => {
    const l = linhaMap.get(codigo)
    return l ? `${l.codigo} — ${l.nome}` : codigo
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-64 bg-slate-200 rounded" />
          <div className="h-32 bg-slate-100 rounded-xl" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Revisão de Classificações</h1>
        <p className="text-slate-500 mt-1">Revise e corrija as classificações feitas pela IA</p>
      </div>

      {erro && (
        <div className="mb-4 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
          {erro}
        </div>
      )}

      {/* Cards de resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Total', valor: stats.total, cor: 'text-slate-800' },
          { label: 'Revisadas', valor: stats.revisadas, cor: 'text-green-600' },
          { label: 'Pendentes', valor: stats.pendentes, cor: 'text-amber-600' },
          { label: 'Baixa confiança', valor: stats.baixa, cor: 'text-red-600' },
        ].map((c) => (
          <div key={c.label} className="bg-white rounded-xl border border-slate-200 p-4">
            <p className="text-xs font-medium text-slate-500">{c.label}</p>
            <p className={`text-2xl font-bold mt-1 ${c.cor}`}>{c.valor}</p>
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex gap-2 mb-4">
        {([
          ['todas', 'Todas'],
          ['pendentes', 'Pendentes'],
          ['baixa_confianca', 'Baixa confiança'],
        ] as [Filtro, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFiltro(key)}
            className={`text-sm px-3 py-1.5 rounded-lg font-medium transition-colors ${
              filtro === key
                ? 'bg-slate-800 text-white'
                : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tabela */}
      {visiveis.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center text-slate-400">
          <p className="text-4xl mb-3">📭</p>
          <p className="font-medium">Nenhuma transação para mostrar</p>
          <p className="text-sm mt-1">
            {itens.length === 0
              ? 'Envie extratos na tela de upload para começar'
              : 'Ajuste o filtro para ver outras classificações'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 uppercase tracking-wide">
                <th className="px-4 py-3 font-medium">Data</th>
                <th className="px-4 py-3 font-medium">Descrição</th>
                <th className="px-4 py-3 font-medium text-right">Valor</th>
                <th className="px-4 py-3 font-medium">Confiança</th>
                <th className="px-4 py-3 font-medium">Linha DRE</th>
                <th className="px-4 py-3 font-medium text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visiveis.map((item) => {
                const efetivo = item.corrigido_para ?? item.linha_dre
                const corrigido = item.corrigido_para != null
                const salvandoEste = salvando.has(item.id)
                const conf = Math.round(item.confianca * 100)
                const confCor =
                  item.confianca >= 0.85
                    ? 'bg-green-100 text-green-700'
                    : item.confianca >= 0.7
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'
                return (
                  <tr key={item.id} className={item.revisado ? 'bg-green-50/40' : ''}>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{fmtData(item.data)}</td>
                    <td className="px-4 py-3 max-w-xs">
                      <p className="text-slate-700 truncate" title={item.descricao}>{item.descricao}</p>
                      {item.conta_nome && (
                        <p className="text-xs text-slate-400">{item.conta_nome}</p>
                      )}
                    </td>
                    <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${item.tipo === 'credito' ? 'text-green-600' : 'text-slate-700'}`}>
                      {item.tipo === 'credito' ? '+' : '−'}{fmtMoeda(Math.abs(item.valor))}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${confCor}`}>{conf}%</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <select
                          value={efetivo}
                          disabled={salvandoEste}
                          onChange={(e) => handleCorrigir(item, e.target.value)}
                          className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs max-w-[220px] focus:outline-none focus:ring-2 focus:ring-slate-500 disabled:opacity-50"
                        >
                          {linhas
                            .filter((l) => l.tipo !== 'grupo' && l.tipo !== 'resultado')
                            .map((l) => (
                              <option key={l.codigo} value={l.codigo}>
                                {l.codigo} — {l.nome}
                              </option>
                            ))}
                        </select>
                        {corrigido && (
                          <span className="text-[10px] text-amber-600 font-medium whitespace-nowrap" title={`IA sugeriu: ${linhaLabel(item.linha_dre)}`}>
                            corrigido
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {item.revisado ? (
                        <button
                          onClick={() => patch(item.id, { revisado: false })}
                          disabled={salvandoEste}
                          className="text-green-600 hover:text-green-700 disabled:opacity-50"
                          title="Marcar como pendente"
                        >
                          ✓ Revisado
                        </button>
                      ) : (
                        <button
                          onClick={() => patch(item.id, { revisado: true })}
                          disabled={salvandoEste}
                          className="text-xs bg-slate-800 text-white px-3 py-1.5 rounded-lg font-medium hover:bg-slate-700 disabled:opacity-50"
                        >
                          Confirmar
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
