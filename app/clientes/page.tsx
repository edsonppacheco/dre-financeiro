import PessoasManager from '@/app/_components/PessoasManager'
export default function ClientesPage() {
  return <PessoasManager endpoint="/api/clientes" singular="Cliente" plural="Clientes" />
}
