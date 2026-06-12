-- Migration 004 — regras de classificação contábil aprendidas
create table if not exists regras_classificacao (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,                 -- contraparte normalizada (ex: "enel")
  conta_contabil_id uuid references plano_contas(id) on delete cascade not null,
  ocorrencias integer not null default 1,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_regras_chave on regras_classificacao(chave);
