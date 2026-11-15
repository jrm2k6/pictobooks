-- Add personalization columns to books (all nullable for backward compat)
ALTER TABLE books ADD COLUMN title TEXT;
ALTER TABLE books ADD COLUMN child_name TEXT;
ALTER TABLE books ADD COLUMN child_age INTEGER;
