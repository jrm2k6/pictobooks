ALTER TABLE book_run_regenerations
  ADD COLUMN feedback_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(feedback_json));
