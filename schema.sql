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
