-- Migration 008 — grau de confiança da classificação automática (null = confirmado/manual)
alter table transacoes add column if not exists confianca numeric(4,3);
