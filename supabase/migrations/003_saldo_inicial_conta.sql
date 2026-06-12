-- Migration 003 — saldo inicial por conta (base do saldo calculado no extrato)
alter table contas add column if not exists saldo_inicial numeric(15,2) not null default 0;
