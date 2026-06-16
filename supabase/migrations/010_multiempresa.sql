-- ============================================================
-- Migration 010 — Multi-empresa, moeda e câmbio mensal
-- Adiciona: tabela de empresas (com moeda), vínculo conta->empresa,
-- câmbio médio mensal e valor_destino nas transferências (cross-moeda).
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================

-- 1) Empresas (cada uma com sua moeda) -----------------------
create table if not exists empresas (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  moeda text not null default 'BRL' check (moeda in ('BRL', 'USD')),
  pais text,
  created_at timestamptz default now()
);

-- Empresa default (Brasil/BRL) para acomodar os dados existentes
insert into empresas (nome, moeda, pais)
select 'Brasil', 'BRL', 'BR'
where not exists (select 1 from empresas);

-- 2) Vínculo conta -> empresa --------------------------------
alter table contas add column if not exists empresa_id uuid references empresas(id) on delete restrict;

-- Backfill: todas as contas sem empresa vão para a empresa BRL mais antiga
update contas
set empresa_id = (select id from empresas where moeda = 'BRL' order by created_at asc limit 1)
where empresa_id is null;

-- 3) Câmbio médio mensal -------------------------------------
-- taxa = quantos 'moeda_destino' equivalem a 1 'moeda_origem' (ex: 1 USD = 5.12 BRL)
create table if not exists cambio_mensal (
  id uuid primary key default gen_random_uuid(),
  mes text not null,                 -- 'YYYY-MM'
  moeda_origem text not null,        -- ex: 'USD'
  moeda_destino text not null,       -- ex: 'BRL'
  taxa numeric(15,6) not null check (taxa > 0),
  fonte text,
  created_at timestamptz default now(),
  unique (mes, moeda_origem, moeda_destino)
);

-- 4) Transferências cross-moeda ------------------------------
-- valor (existente) = valor que SAI na conta de origem (moeda da origem)
-- valor_destino     = valor que ENTRA na conta de destino (moeda do destino)
alter table transferencias add column if not exists valor_destino numeric(15,2);
update transferencias set valor_destino = valor where valor_destino is null;

-- 5) Índices -------------------------------------------------
create index if not exists idx_contas_empresa on contas(empresa_id);
create index if not exists idx_cambio_mes on cambio_mensal(mes);
