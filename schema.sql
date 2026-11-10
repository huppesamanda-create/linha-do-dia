-- Linha do Dia — Financeiro pessoal (PF somente)
-- Banco novo e independente. Não contém tabelas de PJ nem módulos antigos.

CREATE TABLE IF NOT EXISTS ld4_finance_categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS ld4_finance_transactions (
  id TEXT PRIMARY KEY,
  transaction_date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
  nature TEXT CHECK (nature IS NULL OR nature IN ('fixed', 'daily')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  category_id TEXT REFERENCES ld4_finance_categories(id),
  status TEXT NOT NULL CHECK (status IN ('provisioned', 'realized')),
  description TEXT NOT NULL DEFAULT '',
  recurring_rule_id TEXT REFERENCES ld4_finance_recurring_rules(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (type = 'income' AND nature IS NULL AND category_id IS NULL)
    OR
    (type = 'expense' AND nature IN ('fixed', 'daily') AND category_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS ld4_finance_transactions_recurring_unique_idx
  ON ld4_finance_transactions(recurring_rule_id, transaction_date)
  WHERE recurring_rule_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ld4_finance_transactions_date_idx
  ON ld4_finance_transactions(transaction_date);

CREATE INDEX IF NOT EXISTS ld4_finance_transactions_status_idx
  ON ld4_finance_transactions(status);

CREATE INDEX IF NOT EXISTS ld4_finance_recurring_rules_category_idx
  ON ld4_finance_recurring_rules(category_id, active);

CREATE TABLE IF NOT EXISTS ld4_finance_recurring_skips (
  recurring_rule_id TEXT NOT NULL REFERENCES ld4_finance_recurring_rules(id) ON DELETE CASCADE,
  skipped_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (recurring_rule_id, skipped_date)
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

CREATE TABLE IF NOT EXISTS ld4_finance_reserve_accounts (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  opening_balance NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (opening_balance >= 0),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  system_key TEXT,
  asset_type TEXT NOT NULL DEFAULT 'cash' CHECK (asset_type IN ('cash', 'treasury_fixed')),
  maturity_date DATE,
  default_rate NUMERIC(8,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ld4_finance_reserve_accounts_system_key_idx
  ON ld4_finance_reserve_accounts(system_key)
  WHERE system_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS ld4_finance_reserve_transfers (
  id TEXT PRIMARY KEY,
  transfer_date DATE NOT NULL,
  account_id TEXT NOT NULL REFERENCES ld4_finance_reserve_accounts(id),
  direction TEXT NOT NULL CHECK (direction IN ('to_reserve', 'from_reserve')),
  amount NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status TEXT NOT NULL CHECK (status IN ('provisioned', 'realized')),
  description TEXT NOT NULL DEFAULT '',
  contracted_rate NUMERIC(8,4),
  maturity_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_finance_reserve_transfers_date_idx
  ON ld4_finance_reserve_transfers(transfer_date);

CREATE INDEX IF NOT EXISTS ld4_finance_reserve_transfers_account_idx
  ON ld4_finance_reserve_transfers(account_id);

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

-- Categorias iniciais. Se uma categoria for desativada pelo usuário, ela não é reativada em deploys futuros.
INSERT INTO ld4_finance_categories (id, name, sort_order, active)
VALUES
  ('moradia', 'Moradia', 10, TRUE),
  ('mercado', 'Mercado', 20, TRUE),
  ('transporte', 'Transporte', 30, TRUE),
  ('assinaturas', 'Assinaturas', 40, TRUE),
  ('familia', 'Família', 50, TRUE),
  ('lazer', 'Lazer', 60, TRUE),
  ('trabalho', 'Trabalho', 70, TRUE),
  ('dividas', 'Dívidas', 80, TRUE),
  ('outros', 'Outros', 90, TRUE)
ON CONFLICT (id) DO NOTHING;

-- Os três destinos da versão PF atual.
INSERT INTO ld4_finance_reserve_accounts
  (id, name, opening_balance, sort_order, active, system_key, asset_type, maturity_date, default_rate)
VALUES
  ('reserve-emergency', 'Reserva de emergência', 0, 10, TRUE, 'emergency', 'cash', NULL, NULL),
  ('treasury-fixed-2029', 'Tesouro Prefixado 2029', 0, 20, TRUE, 'treasury-2029', 'treasury_fixed', DATE '2029-01-01', 14.95),
  ('treasury-fixed-2032', 'Tesouro Prefixado 2032', 0, 30, TRUE, 'treasury-2032', 'treasury_fixed', DATE '2032-01-01', 15.48)
ON CONFLICT (id) DO NOTHING;

-- Cartões de crédito (PF)
CREATE TABLE IF NOT EXISTS ld4_finance_credit_cards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  closing_day SMALLINT NOT NULL CHECK (closing_day BETWEEN 1 AND 31),
  due_day SMALLINT NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_finance_credit_cards_active_idx
  ON ld4_finance_credit_cards(active, sort_order, name);

CREATE TABLE IF NOT EXISTS ld4_finance_credit_card_purchases (
  id TEXT PRIMARY KEY,
  purchase_date DATE NOT NULL,
  card_id TEXT NOT NULL REFERENCES ld4_finance_credit_cards(id),
  category_id TEXT NOT NULL REFERENCES ld4_finance_categories(id),
  description TEXT NOT NULL DEFAULT '',
  total_amount NUMERIC(14,2) NOT NULL CHECK (total_amount > 0),
  installments SMALLINT NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 36),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ld4_finance_credit_card_purchases_date_idx
  ON ld4_finance_credit_card_purchases(purchase_date);

CREATE INDEX IF NOT EXISTS ld4_finance_credit_card_purchases_card_idx
  ON ld4_finance_credit_card_purchases(card_id, purchase_date);

CREATE TABLE IF NOT EXISTS ld4_finance_credit_card_invoices (
  card_id TEXT NOT NULL REFERENCES ld4_finance_credit_cards(id),
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
  paid_date DATE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (card_id, due_date),
  CHECK ((status = 'open') OR (status = 'paid' AND paid_date IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ld4_finance_credit_card_invoices_status_idx
  ON ld4_finance_credit_card_invoices(status, due_date);
