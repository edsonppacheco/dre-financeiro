'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

const LINKS = [
  { href: '/', label: 'Upload', icon: '📤' },
  { href: '/contas', label: 'Contas', icon: '🧾' },
  { href: '/dre', label: 'Relatórios', icon: '📊' },
  { href: '/clientes', label: 'Clientes', icon: '👥' },
  { href: '/fornecedores', label: 'Fornecedores', icon: '🏭' },
  { href: '/configuracoes', label: 'Configurações', icon: '⚙️' },
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
    <aside className={`sticky top-0 h-screen shrink-0 bg-slate-800 text-white flex flex-col transition-all duration-200 ${aberto ? 'w-56' : 'w-16'}`}>
      <div className={`flex items-center h-14 px-3 border-b border-slate-700 ${aberto ? 'justify-between' : 'justify-center'}`}>
        {aberto && <span className="font-bold tracking-tight whitespace-nowrap">DRE Financeiro</span>}
        <button onClick={toggle} className="text-slate-300 hover:text-white p-1 rounded hover:bg-slate-700" title={aberto ? 'Recolher menu' : 'Expandir menu'}>
          {aberto ? '⟩' : '☰'}
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
            <span className="text-lg leading-none">{l.icon}</span>
            {aberto && <span className="whitespace-nowrap">{l.label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}
