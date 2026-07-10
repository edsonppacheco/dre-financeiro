-- ============================================================
-- Migration 011 — Log de atividades
-- Registro cronológico das ações relevantes do sistema (uploads,
-- edições de lançamento, transferências, câmbio, cadastros...).
-- App single-user: não há "autor". Idempotente.
-- ============================================================

create table if not exists atividades (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  acao text not null,          -- ex: 'upload', 'editar_lancamento', 'transferencia', 'cambio'
  entidade text,               -- ex: 'extrato', 'transacao', 'conta', 'empresa'
  entidade_id uuid,            -- id do registro afetado, quando houver
  descricao text not null,     -- texto legível do que aconteceu
  dados jsonb                  -- detalhes estruturados opcionais
);

create index if not exists idx_atividades_created on atividades(created_at desc);
