ALTER TABLE book_run_execution_configs
  ADD COLUMN initial_candidate_count INTEGER NOT NULL DEFAULT 3
  CHECK (initial_candidate_count BETWEEN 1 AND 3);
