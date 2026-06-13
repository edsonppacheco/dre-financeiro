-- Migration 006 — tipo de conta "emprestimo"
alter table contas drop constraint if exists contas_tipo_check;
alter table contas add constraint contas_tipo_check check (tipo in ('corrente', 'cartao', 'emprestimo'));
