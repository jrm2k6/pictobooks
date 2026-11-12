PRAGMA foreign_keys = ON;

CREATE TABLE api_sessions (
  session_id TEXT PRIMARY KEY,
  token_sha256 TEXT NOT NULL UNIQUE CHECK (length(token_sha256) = 64),
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX api_sessions_user_id_idx ON api_sessions(user_id, expires_at);

CREATE TABLE api_idempotency (
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  operation TEXT NOT NULL,
  response_status INTEGER,
  response_json TEXT CHECK (response_json IS NULL OR json_valid(response_json)),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (owner_id, idempotency_key),
  CHECK (
    (response_status IS NULL AND response_json IS NULL AND completed_at IS NULL) OR
    (response_status BETWEEN 200 AND 299 AND response_json IS NOT NULL AND completed_at IS NOT NULL)
  )
) STRICT, WITHOUT ROWID;

CREATE TABLE upload_intents (
  upload_intent_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  book_id TEXT NOT NULL REFERENCES books(book_id),
  run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  photo_id TEXT NOT NULL REFERENCES photos(photo_id),
  artifact_id TEXT NOT NULL UNIQUE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 26214400),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (run_id, photo_id)
) STRICT;

CREATE INDEX upload_intents_run_id_idx ON upload_intents(run_id, completed_at);

CREATE TABLE book_run_regenerations (
  new_run_id TEXT PRIMARY KEY REFERENCES book_runs(run_id),
  source_run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  source_page_id TEXT NOT NULL REFERENCES pages(page_id),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX canonical_style_pack_revision_idx
  ON canonical_references(style_pack_version, style_pack_revision);
