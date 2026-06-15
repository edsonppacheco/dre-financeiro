-- ============================================================
-- Migration 009 — Deduplicar transações e saldos de extratos
-- Remove lançamentos duplicados causados por reenvio do mesmo
-- arquivo de extrato, mantendo a primeira ocorrência de cada
-- combinação (conta_id, data, descricao, valor, tipo).
-- ============================================================

-- 1) Remove transações duplicadas (mantém a mais antiga por conta_id+data+descricao+valor+tipo)
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY conta_id, data, descricao, valor, tipo
      ORDER BY created_at ASC
    ) AS rn
  FROM transacoes
)
DELETE FROM transacoes WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- 2) Remove saldos_extrato duplicados (mantém o mais antigo por conta_id+data)
WITH dupes AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY conta_id, data
      ORDER BY created_at ASC
    ) AS rn
  FROM saldos_extrato
)
DELETE FROM saldos_extrato WHERE id IN (SELECT id FROM dupes WHERE rn > 1);

-- 3) Marca os extratos que ficaram sem transações como 'duplicado'
UPDATE extratos
SET status = 'duplicado'
WHERE status = 'processado'
  AND id NOT IN (
    SELECT DISTINCT extrato_id FROM transacoes WHERE extrato_id IS NOT NULL
  );
