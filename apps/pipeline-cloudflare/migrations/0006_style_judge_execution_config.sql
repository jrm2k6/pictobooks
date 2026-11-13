ALTER TABLE book_run_execution_configs
  ADD COLUMN style_judge_model TEXT NOT NULL DEFAULT 'mock-style-v1';

ALTER TABLE book_run_execution_configs
  ADD COLUMN style_judge_cost_micros INTEGER NOT NULL DEFAULT 0
  CHECK (style_judge_cost_micros >= 0);
