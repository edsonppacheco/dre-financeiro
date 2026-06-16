import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import SideNav from './_components/SideNav'
import { EmpresaProvider } from './_components/EmpresaProvider'
import EmpresaSelector from './_components/EmpresaSelector'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'DRE Financeiro',
  description: 'Classificação financeira inteligente com IA',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className={`${inter.className} bg-gray-50 min-h-screen`}>
        <EmpresaProvider>
          <div className="flex min-h-screen">
            <SideNav />
            <div className="flex-1 min-w-0 flex flex-col">
              <EmpresaSelector />
              <main className="flex-1 min-w-0 px-4 py-8">
                <div className="max-w-7xl mx-auto">{children}</div>
              </main>
            </div>
          </div>
        </EmpresaProvider>
      </body>
    </html>
  )
}
