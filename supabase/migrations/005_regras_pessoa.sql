-- Migration 005 — regras aprendidas de cliente/fornecedor por contraparte
create table if not exists regras_pessoa (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  cliente_id uuid references clientes(id) on delete cascade,
  fornecedor_id uuid references fornecedores(id) on delete cascade,
  ocorrencias integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_regras_pessoa_chave on regras_pessoa(chave);
