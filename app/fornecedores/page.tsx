import PessoasManager from '@/app/_components/PessoasManager'
export default function FornecedoresPage() {
  return <PessoasManager endpoint="/api/fornecedores" singular="Fornecedor" plural="Fornecedores" />
}
