CREATE TABLE book_run_execution_configs (
  run_id TEXT PRIMARY KEY REFERENCES book_runs(run_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  execution_profile TEXT NOT NULL CHECK (execution_profile IN (
    'mock_pass_initial', 'mock_pass_after_repair', 'mock_never_pass'
  )),
  candidate_cost_micros INTEGER NOT NULL CHECK (candidate_cost_micros >= 0),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX book_run_execution_provider_idx
  ON book_run_execution_configs(provider, model);
