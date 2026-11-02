CREATE TABLE IF NOT EXISTS ld4_activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed')),
  started_at TIMESTAMPTZ NOT NULL,
  last_started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  accumulated_ms BIGINT NOT NULL DEFAULT 0,
  duration_ms BIGINT,
  subtasks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ld4_plans (
  id TEXT PRIMARY KEY,
  planned_date DATE NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_activities_status_idx
  ON ld4_activities(status);

CREATE INDEX IF NOT EXISTS ld4_activities_started_idx
  ON ld4_activities(started_at);

CREATE INDEX IF NOT EXISTS ld4_plans_date_idx
  ON ld4_plans(planned_date, created_at);

CREATE TABLE IF NOT EXISTS ld4_enam_state (
  id TEXT PRIMARY KEY,
  state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ld4_finance_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ld4_finance_transactions (
  id TEXT PRIMARY KEY,
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  nature TEXT CHECK (nature IS NULL OR nature IN ('fixed', 'daily')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category_id TEXT REFERENCES ld4_finance_categories(id),
  status TEXT NOT NULL CHECK (status IN ('provisioned', 'realized')),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (type = 'income' AND nature IS NULL AND category_id IS NULL)
    OR
    (type = 'expense' AND nature IN ('fixed', 'daily') AND category_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS ld4_finance_budgets (
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  category_id TEXT NOT NULL REFERENCES ld4_finance_categories(id),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (year, month, category_id)
);

CREATE TABLE IF NOT EXISTS ld4_finance_years (
  year INTEGER PRIMARY KEY,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0,
  warning_threshold NUMERIC(14,2) NOT NULL DEFAULT 1000 CHECK (warning_threshold >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_finance_transactions_date_idx
  ON ld4_finance_transactions(transaction_date);

CREATE INDEX IF NOT EXISTS ld4_finance_transactions_status_idx
  ON ld4_finance_transactions(status);

INSERT INTO ld4_finance_categories (id, name, sort_order)
VALUES
  ('moradia', 'Moradia', 10),
  ('mercado', 'Mercado', 20),
  ('transporte', 'Transporte', 30),
  ('assinaturas', 'Assinaturas', 40),
  ('familia', 'Família', 50),
  ('lazer', 'Lazer', 60),
  ('trabalho', 'Trabalho', 70),
  ('dividas', 'Dívidas', 80),
  ('outros', 'Outros', 90)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ld4_finance_reserve_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ld4_finance_reserve_transfers (
  id TEXT PRIMARY KEY,
  transfer_date DATE NOT NULL,
  account_id TEXT NOT NULL REFERENCES ld4_finance_reserve_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('to_reserve', 'from_reserve')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('provisioned', 'realized')),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_finance_reserve_transfers_date_idx
  ON ld4_finance_reserve_transfers(transfer_date);

CREATE INDEX IF NOT EXISTS ld4_finance_reserve_transfers_account_idx
  ON ld4_finance_reserve_transfers(account_id);

INSERT INTO ld4_finance_reserve_accounts (id, name, opening_balance, sort_order)
VALUES ('investimentos', 'Investimentos', 0, 10)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS ld4_habit_days (
  habit_day DATE PRIMARY KEY,
  water_count SMALLINT NOT NULL DEFAULT 0 CHECK (water_count BETWEEN 0 AND 3),
  exercise BOOLEAN NOT NULL DEFAULT FALSE,
  sleep_before_2330 BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_habit_days_day_idx
  ON ld4_habit_days(habit_day);

CREATE TABLE IF NOT EXISTS ld4_finance_recurring_rules (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES ld4_finance_categories(id),
  name TEXT NOT NULL,
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  day_of_month SMALLINT NOT NULL CHECK (day_of_month BETWEEN 1 AND 31),
  frequency TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency = 'monthly'),
  start_month DATE NOT NULL,
  end_month DATE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_month IS NULL OR end_month >= start_month)
);

ALTER TABLE ld4_finance_transactions
  ADD COLUMN IF NOT EXISTS recurring_rule_id TEXT
  REFERENCES ld4_finance_recurring_rules(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ld4_finance_transactions_recurring_unique_idx
  ON ld4_finance_transactions(recurring_rule_id, transaction_date)
  WHERE recurring_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ld4_finance_recurring_rules_category_idx
  ON ld4_finance_recurring_rules(category_id, active);

CREATE TABLE IF NOT EXISTS ld4_finance_recurring_skips (
  recurring_rule_id TEXT NOT NULL REFERENCES ld4_finance_recurring_rules(id) ON DELETE CASCADE,
  skipped_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recurring_rule_id, skipped_date)
);

-- v5.1 · destinos e lotes de investimentos
ALTER TABLE ld4_finance_reserve_accounts
  ADD COLUMN IF NOT EXISTS system_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ld4_finance_reserve_accounts_system_key_idx
  ON ld4_finance_reserve_accounts(system_key)
  WHERE system_key IS NOT NULL;

ALTER TABLE ld4_finance_reserve_accounts
  ADD COLUMN IF NOT EXISTS asset_type TEXT NOT NULL DEFAULT 'cash'
  CHECK (asset_type IN ('cash', 'treasury_fixed'));

ALTER TABLE ld4_finance_reserve_accounts
  ADD COLUMN IF NOT EXISTS maturity_date DATE;

ALTER TABLE ld4_finance_reserve_accounts
  ADD COLUMN IF NOT EXISTS default_rate NUMERIC(8,4);

ALTER TABLE ld4_finance_reserve_transfers
  ADD COLUMN IF NOT EXISTS contracted_rate NUMERIC(8,4);

ALTER TABLE ld4_finance_reserve_transfers
  ADD COLUMN IF NOT EXISTS maturity_date DATE;

CREATE TABLE IF NOT EXISTS ld4_finance_investment_valuations (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ld4_finance_reserve_accounts(id) ON DELETE CASCADE,
  valuation_date DATE NOT NULL,
  current_value NUMERIC(14,2) NOT NULL CHECK (current_value >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(account_id, valuation_date)
);

CREATE INDEX IF NOT EXISTS ld4_finance_investment_valuations_account_date_idx
  ON ld4_finance_investment_valuations(account_id, valuation_date DESC);

UPDATE ld4_finance_reserve_accounts
   SET system_key = 'emergency',
       asset_type = 'cash',
       maturity_date = NULL,
       default_rate = NULL,
       updated_at = NOW()
 WHERE LOWER(name) = LOWER('Reserva de emergência')
   AND (system_key IS NULL OR system_key = 'emergency');

UPDATE ld4_finance_reserve_accounts
   SET system_key = 'treasury-2029',
       asset_type = 'treasury_fixed',
       maturity_date = DATE '2029-01-01',
       default_rate = 14.95,
       updated_at = NOW()
 WHERE LOWER(name) = LOWER('Tesouro Prefixado 2029')
   AND (system_key IS NULL OR system_key = 'treasury-2029');

UPDATE ld4_finance_reserve_accounts
   SET system_key = 'treasury-2032',
       asset_type = 'treasury_fixed',
       maturity_date = DATE '2032-01-01',
       default_rate = 15.48,
       updated_at = NOW()
 WHERE LOWER(name) = LOWER('Tesouro Prefixado 2032')
   AND (system_key IS NULL OR system_key = 'treasury-2032');

INSERT INTO ld4_finance_reserve_accounts
  (id, name, opening_balance, sort_order, active, system_key, asset_type, maturity_date, default_rate, created_at, updated_at)
SELECT
  'reserve-emergency',
  'Reserva de emergência',
  0,
  10,
  TRUE,
  'emergency',
  'cash',
  NULL,
  NULL,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM ld4_finance_reserve_accounts WHERE system_key = 'emergency'
);

INSERT INTO ld4_finance_reserve_accounts
  (id, name, opening_balance, sort_order, active, system_key, asset_type, maturity_date, default_rate, created_at, updated_at)
SELECT
  'treasury-fixed-2029',
  'Tesouro Prefixado 2029',
  0,
  20,
  TRUE,
  'treasury-2029',
  'treasury_fixed',
  DATE '2029-01-01',
  14.95,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM ld4_finance_reserve_accounts WHERE system_key = 'treasury-2029'
);

INSERT INTO ld4_finance_reserve_accounts
  (id, name, opening_balance, sort_order, active, system_key, asset_type, maturity_date, default_rate, created_at, updated_at)
SELECT
  'treasury-fixed-2032',
  'Tesouro Prefixado 2032',
  0,
  30,
  TRUE,
  'treasury-2032',
  'treasury_fixed',
  DATE '2032-01-01',
  15.48,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM ld4_finance_reserve_accounts WHERE system_key = 'treasury-2032'
);

-- v5.1.1 · remove a conta genérica "Investimentos" sem perder histórico.
DO $$
DECLARE
  old_id TEXT;
  emergency_id TEXT;
  old_opening NUMERIC(14,2);
BEGIN
  SELECT id, opening_balance
    INTO old_id, old_opening
    FROM ld4_finance_reserve_accounts
   WHERE id = 'investimentos'
      OR LOWER(name) = LOWER('Investimentos')
   ORDER BY CASE WHEN id = 'investimentos' THEN 0 ELSE 1 END
   LIMIT 1;

  SELECT id
    INTO emergency_id
    FROM ld4_finance_reserve_accounts
   WHERE system_key = 'emergency'
   LIMIT 1;

  IF old_id IS NOT NULL
     AND emergency_id IS NOT NULL
     AND old_id <> emergency_id
     AND EXISTS (
       SELECT 1
         FROM ld4_finance_reserve_accounts
        WHERE id = old_id
          AND active = TRUE
     )
  THEN
    UPDATE ld4_finance_reserve_accounts
       SET opening_balance = opening_balance + COALESCE(old_opening, 0),
           updated_at = NOW()
     WHERE id = emergency_id;

    UPDATE ld4_finance_reserve_transfers
       SET account_id = emergency_id,
           updated_at = NOW()
     WHERE account_id = old_id;

    UPDATE ld4_finance_reserve_accounts
       SET opening_balance = 0,
           active = FALSE,
           updated_at = NOW()
     WHERE id = old_id;
  END IF;
END $$;

-- Garante que os três destinos oficiais permaneçam ativos.
UPDATE ld4_finance_reserve_accounts
   SET active = TRUE,
       updated_at = NOW()
 WHERE system_key IN ('emergency', 'treasury-2029', 'treasury-2032');

-- v6.0 · separação PF / PJ
ALTER TABLE ld4_finance_categories
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

ALTER TABLE ld4_finance_transactions
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

ALTER TABLE ld4_finance_budgets
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

ALTER TABLE ld4_finance_years
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

ALTER TABLE ld4_finance_reserve_accounts
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

ALTER TABLE ld4_finance_recurring_rules
  ADD COLUMN IF NOT EXISTS owner_scope TEXT NOT NULL DEFAULT 'pf'
  CHECK (owner_scope IN ('pf', 'pj'));

-- Os registros existentes pertencem à PF.
UPDATE ld4_finance_categories SET owner_scope = 'pf' WHERE owner_scope IS NULL;
UPDATE ld4_finance_transactions SET owner_scope = 'pf' WHERE owner_scope IS NULL;
UPDATE ld4_finance_budgets SET owner_scope = 'pf' WHERE owner_scope IS NULL;
UPDATE ld4_finance_years SET owner_scope = 'pf' WHERE owner_scope IS NULL;
UPDATE ld4_finance_reserve_accounts SET owner_scope = 'pf' WHERE owner_scope IS NULL;
UPDATE ld4_finance_recurring_rules SET owner_scope = 'pf' WHERE owner_scope IS NULL;

-- Categoria pode ter o mesmo nome na PF e na PJ.
ALTER TABLE ld4_finance_categories
  DROP CONSTRAINT IF EXISTS ld4_finance_categories_name_key;

CREATE UNIQUE INDEX IF NOT EXISTS ld4_finance_categories_scope_name_idx
  ON ld4_finance_categories(owner_scope, LOWER(name));

CREATE INDEX IF NOT EXISTS ld4_finance_transactions_scope_date_idx
  ON ld4_finance_transactions(owner_scope, transaction_date);

CREATE INDEX IF NOT EXISTS ld4_finance_categories_scope_idx
  ON ld4_finance_categories(owner_scope, active, sort_order);

CREATE INDEX IF NOT EXISTS ld4_finance_reserve_accounts_scope_idx
  ON ld4_finance_reserve_accounts(owner_scope, active, sort_order);

CREATE INDEX IF NOT EXISTS ld4_finance_recurring_rules_scope_idx
  ON ld4_finance_recurring_rules(owner_scope, active);

-- Orçamento e saldo inicial passam a ser independentes por PF/PJ.
ALTER TABLE ld4_finance_budgets
  DROP CONSTRAINT IF EXISTS ld4_finance_budgets_pkey;

ALTER TABLE ld4_finance_budgets
  ADD CONSTRAINT ld4_finance_budgets_pkey
  PRIMARY KEY (owner_scope, year, month, category_id);

ALTER TABLE ld4_finance_years
  DROP CONSTRAINT IF EXISTS ld4_finance_years_pkey;

ALTER TABLE ld4_finance_years
  ADD CONSTRAINT ld4_finance_years_pkey
  PRIMARY KEY (owner_scope, year);

-- Categorias iniciais da PJ.
INSERT INTO ld4_finance_categories
  (id, name, sort_order, active, owner_scope, created_at, updated_at)
VALUES
  ('pj-contabilidade', 'Contabilidade', 10, TRUE, 'pj', NOW(), NOW()),
  ('pj-softwares', 'Softwares', 20, TRUE, 'pj', NOW(), NOW()),
  ('pj-marketing', 'Marketing', 30, TRUE, 'pj', NOW(), NOW()),
  ('pj-estrutura', 'Estrutura', 40, TRUE, 'pj', NOW(), NOW()),
  ('pj-impostos-taxas', 'Impostos e taxas', 50, TRUE, 'pj', NOW(), NOW()),
  ('pj-pro-labore', 'Pró-labore', 60, TRUE, 'pj', NOW(), NOW()),
  ('pj-outros', 'Outros', 70, TRUE, 'pj', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  sort_order = EXCLUDED.sort_order,
  active = TRUE,
  owner_scope = 'pj',
  updated_at = NOW();

-- Destinos fixos da PJ.
INSERT INTO ld4_finance_reserve_accounts
  (id, name, opening_balance, sort_order, active, system_key, asset_type, maturity_date, default_rate, owner_scope, created_at, updated_at)
VALUES
  ('pj-tax-reserve', 'Reserva para impostos', 0, 10, TRUE, 'pj-tax', 'cash', NULL, NULL, 'pj', NOW(), NOW()),
  ('pj-operating-reserve', 'Reserva operacional', 0, 20, TRUE, 'pj-operating', 'cash', NULL, NULL, 'pj', NOW(), NOW())
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  active = TRUE,
  system_key = EXCLUDED.system_key,
  asset_type = 'cash',
  owner_scope = 'pj',
  updated_at = NOW();

-- Garante que os três destinos da PF continuem no escopo pessoal.
UPDATE ld4_finance_reserve_accounts
   SET owner_scope = 'pf',
       updated_at = NOW()
 WHERE system_key IN ('emergency', 'treasury-2029', 'treasury-2032');

