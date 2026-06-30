'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState, type ReactNode } from 'react'

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 shrink-0">{d}</svg>
)
const icones: Record<string, ReactNode> = {
  painel: I(<><rect x="3" y="3" width="7" height="9" rx="1" /><rect x="14" y="3" width="7" height="5" rx="1" /><rect x="14" y="12" width="7" height="9" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /></>),
  contas: I(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>),
  relatorios: I(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>),
  distribuicao: I(<><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></>),
  clientes: I(<><circle cx="9" cy="8" r="3" /><path d="M3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-5-5.9" /></>),
  fornecedores: I(<><path d="M3 7h11v8H3zM14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></>),
  upload: I(<><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></>),
  config: I(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 2.6 15H2a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4 9.4a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 4.6V4a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 2.7 1.1 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V11a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>),
}

const LINKS = [
  { href: '/', label: 'Painel', icon: 'painel' },
  { href: '/contas', label: 'Contas', icon: 'contas' },
  { href: '/dre', label: 'Relatórios', icon: 'relatorios' },
  { href: '/distribuicao', label: 'Distribuição', icon: 'distribuicao' },
  { href: '/clientes', label: 'Clientes', icon: 'clientes' },
  { href: '/fornecedores', label: 'Fornecedores', icon: 'fornecedores' },
  { href: '/upload', label: 'Upload', icon: 'upload' },
  { href: '/configuracoes', label: 'Configurações', icon: 'config' },
]

export default function SideNav() {
  const pathname = usePathname()
  const [aberto, setAberto] = useState(true)

  useEffect(() => {
    const v = localStorage.getItem('menu_aberto')
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v !== null) setAberto(v === '1')
  }, [])
  const toggle = () => setAberto((a) => { localStorage.setItem('menu_aberto', a ? '0' : '1'); return !a })

  const ativo = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))

  return (
    <aside className={`sticky top-0 h-screen shrink-0 bg-slate-900 text-white flex flex-col transition-all duration-200 ${aberto ? 'w-56' : 'w-16'}`}>
      <div className={`flex items-center h-14 px-3 border-b border-slate-700/60 ${aberto ? 'justify-between' : 'justify-center'}`}>
        {aberto && <span className="font-bold tracking-tight whitespace-nowrap text-lg">SmallFin</span>}
        <button onClick={toggle} className="text-slate-300 hover:text-white p-1 rounded hover:bg-slate-700" title={aberto ? 'Recolher menu' : 'Expandir menu'}>
          {aberto
            ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5"><path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" /></svg>}
        </button>
      </div>
      <nav className="flex-1 py-2">
        {LINKS.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            title={l.label}
            className={`flex items-center gap-3 px-3 h-11 text-sm font-medium transition-colors ${aberto ? '' : 'justify-center'} ${
              ativo(l.href) ? 'bg-slate-700 text-white' : 'text-slate-300 hover:text-white hover:bg-slate-700/60'
            }`}
          >
            {icones[l.icon]}
            {aberto && <span className="whitespace-nowrap">{l.label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
