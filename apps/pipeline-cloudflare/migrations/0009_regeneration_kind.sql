ALTER TABLE book_run_regenerations
  ADD COLUMN kind TEXT NOT NULL DEFAULT 'candidate_regeneration'
  CHECK (kind IN ('candidate_regeneration', 'photo_replacement'));
