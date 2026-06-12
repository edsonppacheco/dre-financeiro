-- ============================================================
-- Migration 002 — Fundação v2
-- Adiciona: tipo de conta, plano de contas contábeis (coexiste com
-- linhas_dre), clientes, fornecedores, vínculos nas transações,
-- transferências e campos de saldo (para conciliação/extrato).
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================

-- 1) Contas correntes x cartão de crédito ---------------------
alter table contas add column if not exists tipo text not null default 'corrente'
  check (tipo in ('corrente', 'cartao'));

-- 2) Plano de contas contábeis (configurável) -----------------
create table if not exists plano_contas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  nome text not null,
  tipo text not null check (tipo in ('receita', 'imposto', 'despesa', 'distribuicao', 'grupo')),
  pai_id uuid references plano_contas(id) on delete cascade,
  ordem integer not null default 0,
  created_at timestamptz default now()
);

-- Default editável
insert into plano_contas (codigo, nome, tipo, ordem) values
  ('1',   'Receitas',                'receita',      1),
  ('2',   'Impostos diretos',        'imposto',      2),
  ('3',   'Despesas',                'grupo',        3),
  ('3.1', 'Folha de pagamento',      'despesa',      4),
  ('3.2', 'Comissões',               'despesa',      5),
  ('3.3', 'Marketing',               'despesa',      6),
  ('3.4', 'Jurídico e Contábil',     'despesa',      7),
  ('3.5', 'Despesas com tecnologia', 'despesa',      8),
  ('3.6', 'Despesas gerais',         'despesa',      9),
  ('3.7', 'Distribuição de lucros',  'distribuicao', 10)
on conflict (codigo) do nothing;

-- Liga filhos ao pai pelo código (3.x -> 3)
update plano_contas c
set pai_id = p.id
from plano_contas p
where p.codigo = split_part(c.codigo, '.', 1)
  and c.codigo like '%.%'
  and c.pai_id is null;

-- 3) Clientes e Fornecedores ----------------------------------
create table if not exists clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  email text,
  telefone text,
  endereco text,
  razao_social text,
  created_at timestamptz default now()
);

create table if not exists fornecedores (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  cnpj text,
  email text,
  telefone text,
  endereco text,
  razao_social text,
  created_at timestamptz default now()
);

-- 4) Transações: vínculos, conta contábil, manual, saldo ------
alter table transacoes add column if not exists conta_id uuid references contas(id) on delete cascade;
alter table transacoes add column if not exists cliente_id uuid references clientes(id) on delete set null;
alter table transacoes add column if not exists fornecedor_id uuid references fornecedores(id) on delete set null;
alter table transacoes add column if not exists conta_contabil_id uuid references plano_contas(id) on delete set null;
alter table transacoes add column if not exists manual boolean not null default false;
alter table transacoes add column if not exists saldo_documento numeric(15,2); -- saldo fim-do-dia extraído do extrato, se houver

-- Lançamentos manuais/transferências não têm extrato
alter table transacoes alter column extrato_id drop not null;

-- Backfill: conta_id a partir do extrato existente
update transacoes t
set conta_id = e.conta_id
from extratos e
where t.extrato_id = e.id and t.conta_id is null;

-- 5) Extratos: período e saldos do documento ------------------
alter table extratos add column if not exists data_inicio date;
alter table extratos add column if not exists data_fim date;
alter table extratos add column if not exists saldo_inicial numeric(15,2);
alter table extratos add column if not exists saldo_final numeric(15,2);

-- Saldos de fim-de-dia extraídos do documento (para conciliação/alertas)
create table if not exists saldos_extrato (
  id uuid primary key default gen_random_uuid(),
  extrato_id uuid references extratos(id) on delete cascade not null,
  conta_id uuid references contas(id) on delete cascade not null,
  data date not null,
  saldo numeric(15,2) not null,
  created_at timestamptz default now()
);

-- 6) Transferências (pagamento de cartão = conta -> cartão) ----
create table if not exists transferencias (
  id uuid primary key default gen_random_uuid(),
  conta_origem_id uuid references contas(id) on delete cascade not null,
  conta_destino_id uuid references contas(id) on delete cascade not null,
  data date not null,
  valor numeric(15,2) not null check (valor > 0),
  descricao text,
  created_at timestamptz default now()
);

-- 7) Índices --------------------------------------------------
create index if not exists idx_plano_contas_pai on plano_contas(pai_id);
create index if not exists idx_transacoes_conta on transacoes(conta_id);
create index if not exists idx_transacoes_cliente on transacoes(cliente_id);
create index if not exists idx_transacoes_fornecedor on transacoes(fornecedor_id);
create index if not exists idx_transacoes_conta_contabil on transacoes(conta_contabil_id);
create index if not exists idx_saldos_extrato_conta_data on saldos_extrato(conta_id, data);
create index if not exists idx_transferencias_origem on transferencias(conta_origem_id);
create index if not exists idx_transferencias_destino on transferencias(conta_destino_id);
