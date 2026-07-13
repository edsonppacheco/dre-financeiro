-- ============================================================
-- Migration 012 — Planejamento (previsões de receitas e despesas)
-- Receitas: N lançamentos previstos por cliente, cada um com data cheia.
-- Despesas: N lançamentos por conta contábil, sempre por mês (sem dia).
-- Ambos escopados por empresa (moeda) para conciliar com o realizado.
-- Idempotente: pode rodar mais de uma vez.
-- ============================================================

-- 1) Previsão de receitas (base: cliente) --------------------
create table if not exists planejamento_receitas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  cliente_id uuid references clientes(id) on delete cascade not null,
  data_prevista date not null,
  valor_previsto numeric(15,2) not null check (valor_previsto >= 0),
  descricao text,
  created_at timestamptz default now()
);

-- 2) Previsão de despesas (base: conta contábil, por mês) ----
create table if not exists planejamento_despesas (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid references empresas(id) on delete cascade not null,
  conta_contabil_id uuid references plano_contas(id) on delete cascade not null,
  mes text not null,                 -- 'YYYY-MM'
  valor_previsto numeric(15,2) not null check (valor_previsto >= 0),
  descricao text,
  created_at timestamptz default now(),
  unique (empresa_id, conta_contabil_id, mes)
);

-- 3) Índices -------------------------------------------------
create index if not exists idx_plan_rec_empresa on planejamento_receitas(empresa_id);
create index if not exists idx_plan_rec_cliente on planejamento_receitas(cliente_id);
create index if not exists idx_plan_desp_empresa on planejamento_despesas(empresa_id);
create index if not exists idx_plan_desp_conta on planejamento_despesas(conta_contabil_id);
