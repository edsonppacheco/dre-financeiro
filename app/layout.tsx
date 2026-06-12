import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Link from 'next/link'
import './globals.css'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'DRE Financeiro',
  description: 'Classificação financeira inteligente com IA',
}

const navLinks = [
  { href: '/', label: 'Upload' },
  { href: '/revisao', label: 'Revisão' },
  { href: '/dre', label: 'DRE' },
  { href: '/configuracoes', label: 'Configurações' },
]

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <nav className="bg-slate-800 text-white">
          <div className="max-w-7xl mx-auto px-4 h-14 flex items-center gap-6">
            <span className="font-bold text-lg tracking-tight">DRE Financeiro</span>
            <div className="flex gap-1 ml-4">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-3 py-1.5 rounded text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </nav>
        <main className="max-w-7xl mx-auto px-4 py-8">{children}</main>
      </body>
    </html>
  )
}
