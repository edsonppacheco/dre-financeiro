-- Contas bancárias
create table if not exists contas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  banco text not null,
  created_at timestamptz default now()
);

-- Extratos enviados
create table if not exists extratos (
  id uuid primary key default gen_random_uuid(),
  conta_id uuid references contas(id) on delete cascade not null,
  mes_referencia date not null,
  arquivo_url text not null,
  status text not null default 'pendente' check (status in ('pendente', 'processando', 'processado', 'erro')),
  created_at timestamptz default now()
);

-- Transações parseadas
create table if not exists transacoes (
  id uuid primary key default gen_random_uuid(),
  extrato_id uuid references extratos(id) on delete cascade not null,
  data date not null,
  descricao text not null,
  valor numeric(15,2) not null,
  tipo text not null check (tipo in ('credito', 'debito')),
  created_at timestamptz default now()
);

-- Linhas da DRE
create table if not exists linhas_dre (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  tipo text not null check (tipo in ('receita', 'custo', 'despesa', 'resultado', 'grupo')),
  ordem integer not null,
  pai_id uuid references linhas_dre(id) on delete set null,
  created_at timestamptz default now()
);

-- Classificações da IA
create table if not exists classificacoes (
  id uuid primary key default gen_random_uuid(),
  transacao_id uuid references transacoes(id) on delete cascade not null unique,
  linha_dre text not null,
  confianca numeric(4,3) not null check (confianca between 0 and 1),
  revisado boolean not null default false,
  corrigido_para text,
  created_at timestamptz default now()
);

-- Índices
create index if not exists idx_transacoes_extrato on transacoes(extrato_id);
create index if not exists idx_classificacoes_transacao on classificacoes(transacao_id);
create index if not exists idx_extratos_conta on extratos(conta_id);
create index if not exists idx_extratos_mes on extratos(mes_referencia);

-- Seed: linhas DRE padrão
insert into linhas_dre (codigo, nome, tipo, ordem, pai_id) values
  ('1', 'Receita Bruta', 'grupo', 1, null),
  ('1.1', 'Receitas de Serviços', 'receita', 2, null),
  ('1.2', 'Receitas de Produtos', 'receita', 3, null),
  ('2', 'Deduções da Receita', 'grupo', 4, null),
  ('2.1', 'Impostos sobre Vendas', 'custo', 5, null),
  ('2.2', 'Devoluções', 'custo', 6, null),
  ('3', 'Receita Líquida', 'resultado', 7, null),
  ('4', 'Custo dos Serviços/Produtos', 'grupo', 8, null),
  ('4.1', 'Custo de Mão de Obra', 'custo', 9, null),
  ('4.2', 'Custo de Materiais', 'custo', 10, null),
  ('5', 'Lucro Bruto', 'resultado', 11, null),
  ('6', 'Despesas Operacionais', 'grupo', 12, null),
  ('6.1', 'Despesas Administrativas', 'despesa', 13, null),
  ('6.2', 'Despesas com Pessoal', 'despesa', 14, null),
  ('6.3', 'Despesas de Marketing', 'despesa', 15, null),
  ('6.4', 'Despesas Financeiras', 'despesa', 16, null),
  ('6.5', 'Depreciação e Amortização', 'despesa', 17, null),
  ('7', 'Outras Receitas/Despesas', 'grupo', 18, null),
  ('7.1', 'Receitas Financeiras', 'receita', 19, null),
  ('7.2', 'Outras Receitas', 'receita', 20, null),
  ('8', 'Resultado Antes do IR', 'resultado', 21, null),
  ('9', 'Impostos (IR/CSLL)', 'despesa', 22, null),
  ('10', 'Lucro Líquido', 'resultado', 23, null)
on conflict (codigo) do nothing;
