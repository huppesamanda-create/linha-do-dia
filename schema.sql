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
