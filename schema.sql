CREATE TABLE IF NOT EXISTS activities (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
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

CREATE INDEX IF NOT EXISTS idx_activities_status
  ON activities(status);

CREATE INDEX IF NOT EXISTS idx_activities_started_at
  ON activities(started_at DESC);
