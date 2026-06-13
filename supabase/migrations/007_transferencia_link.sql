-- Migration 007 — vincula os dois lançamentos de uma transferência
alter table transacoes add column if not exists transferencia_id uuid references transferencias(id) on delete cascade;
create index if not exists idx_transacoes_transferencia on transacoes(transferencia_id);
