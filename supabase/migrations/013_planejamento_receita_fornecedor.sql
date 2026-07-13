-- ============================================================
-- Migration 013 — Contraparte de receita prevista pode ser fornecedor
-- A previsão de receita (contas a receber) passa a aceitar cliente OU
-- fornecedor (ex: reembolso/recebimento de um fornecedor). Exatamente um
-- dos dois é preenchido (validado na API).
-- Idempotente.
-- ============================================================

alter table planejamento_receitas alter column cliente_id drop not null;
alter table planejamento_receitas add column if not exists fornecedor_id uuid references fornecedores(id) on delete cascade;
create index if not exists idx_plan_rec_fornecedor on planejamento_receitas(fornecedor_id);
