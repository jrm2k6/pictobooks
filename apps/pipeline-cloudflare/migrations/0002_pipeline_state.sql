PRAGMA foreign_keys = ON;

ALTER TABLE sources RENAME TO spike_sources;
ALTER TABLE runs RENAME TO spike_runs;
ALTER TABLE operations RENAME TO spike_operations;
ALTER TABLE artifacts RENAME TO spike_artifacts;

CREATE TABLE books (
  book_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft', 'processing', 'review', 'completed', 'cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE book_runs (
  run_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL REFERENCES books(book_id),
  status TEXT NOT NULL CHECK (status IN ('created', 'running', 'partially_completed', 'completed', 'failed', 'cancelled')),
  style_pack_version TEXT NOT NULL,
  cost_ceiling_micros INTEGER NOT NULL CHECK (cost_ceiling_micros >= 0),
  cost_spent_micros INTEGER NOT NULL DEFAULT 0 CHECK (cost_spent_micros >= 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  CHECK (cost_spent_micros <= cost_ceiling_micros)
) STRICT;

CREATE TABLE photos (
  photo_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  source_artifact_id TEXT,
  intake_status TEXT NOT NULL DEFAULT 'pending' CHECK (intake_status IN ('pending', 'accepted', 'rejected', 'needs_review')),
  created_at TEXT NOT NULL,
  UNIQUE (run_id, ordinal),
  UNIQUE (run_id, photo_id)
) STRICT;

CREATE TABLE pages (
  page_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  photo_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'created', 'analyzing', 'generating', 'print_qa', 'style_qa', 'repairing',
    'intake_rejected', 'intake_needs_review', 'needs_human_review',
    'provider_failed', 'budget_exhausted', 'approved', 'rejected'
  )),
  initial_candidate_count INTEGER NOT NULL DEFAULT 0 CHECK (initial_candidate_count BETWEEN 0 AND 3),
  repair_round_count INTEGER NOT NULL DEFAULT 0 CHECK (repair_round_count BETWEEN 0 AND 2),
  approved_candidate_id TEXT,
  approval_source TEXT CHECK (approval_source IS NULL OR approval_source IN ('automatic', 'human')),
  terminal_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (run_id, photo_id) REFERENCES photos(run_id, photo_id),
  UNIQUE (run_id, photo_id),
  UNIQUE (run_id, page_id),
  UNIQUE (page_id, run_id),
  CHECK (
    (state = 'approved' AND approved_candidate_id IS NOT NULL AND approval_source IS NOT NULL) OR
    (state <> 'approved' AND approved_candidate_id IS NULL AND approval_source IS NULL)
  )
) STRICT;

CREATE TABLE operations (
  operation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  page_id TEXT,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN (
    'analyze_photo', 'generate_initial', 'print_qa', 'style_qa',
    'generate_repair', 'normalize', 'export', 'review', 'canonical_promotion'
  )),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'failed', 'outcome_ambiguous')),
  semantic_attempt INTEGER NOT NULL DEFAULT 0 CHECK (semantic_attempt BETWEEN 0 AND 2),
  infrastructure_retry_count INTEGER NOT NULL DEFAULT 0 CHECK (infrastructure_retry_count BETWEEN 0 AND 3),
  outcome_json TEXT CHECK (outcome_json IS NULL OR json_valid(outcome_json)),
  failure_class TEXT CHECK (failure_class IS NULL OR failure_class IN ('transient', 'permanent', 'ambiguous')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (page_id, run_id) REFERENCES pages(page_id, run_id)
) STRICT;

CREATE TABLE provider_attempts (
  provider_attempt_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL REFERENCES operations(operation_id),
  run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_request_id TEXT,
  infrastructure_attempt INTEGER NOT NULL CHECK (infrastructure_attempt BETWEEN 1 AND 3),
  semantic_attempt INTEGER NOT NULL CHECK (semantic_attempt BETWEEN 0 AND 2),
  status TEXT NOT NULL CHECK (status IN ('claimed', 'submitted', 'succeeded', 'transient_failure', 'permanent_failure', 'outcome_ambiguous')),
  estimated_cost_micros INTEGER NOT NULL DEFAULT 0 CHECK (estimated_cost_micros >= 0),
  actual_cost_micros INTEGER CHECK (actual_cost_micros IS NULL OR actual_cost_micros >= 0),
  started_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (operation_id, infrastructure_attempt),
  UNIQUE (provider, provider_request_id)
) STRICT;

CREATE TABLE repair_rounds (
  repair_round_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(page_id),
  round_number INTEGER NOT NULL CHECK (round_number BETWEEN 1 AND 2),
  requested_candidate_count INTEGER NOT NULL CHECK (requested_candidate_count BETWEEN 1 AND 2),
  source_candidate_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('claimed', 'running', 'completed', 'failed', 'needs_human_review')),
  strategy TEXT NOT NULL CHECK (strategy IN ('repair_candidate', 'regenerate_from_source')),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  UNIQUE (page_id, round_number)
) STRICT;

CREATE TABLE candidates (
  candidate_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL REFERENCES pages(page_id),
  operation_id TEXT NOT NULL REFERENCES operations(operation_id),
  repair_round_id TEXT REFERENCES repair_rounds(repair_round_id),
  generation_kind TEXT NOT NULL CHECK (generation_kind IN ('initial', 'repair')),
  ordinal INTEGER NOT NULL CHECK (ordinal > 0),
  raw_artifact_id TEXT,
  clean_artifact_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (page_id, ordinal),
  UNIQUE (page_id, candidate_id),
  CHECK (
    (generation_kind = 'initial' AND repair_round_id IS NULL) OR
    (generation_kind = 'repair' AND repair_round_id IS NOT NULL)
  )
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES book_runs(run_id),
  page_id TEXT REFERENCES pages(page_id),
  producing_operation_id TEXT REFERENCES operations(operation_id),
  object_key TEXT NOT NULL UNIQUE,
  artifact_kind TEXT NOT NULL CHECK (artifact_kind IN (
    'source_photo', 'normalized_photo', 'page_brief', 'candidate_raw',
    'candidate_clean', 'print_qa', 'style_qa', 'style_bible',
    'canonical_reference', 'book_export'
  )),
  schema_version TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  mime_type TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  retention_class TEXT NOT NULL CHECK (retention_class IN ('source', 'derived', 'canonical', 'export', 'audit')),
  deleted_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_relations (
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  source_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  relation_kind TEXT NOT NULL CHECK (relation_kind IN ('derived_from', 'judges', 'packages', 'references')),
  PRIMARY KEY (artifact_id, source_artifact_id, relation_kind),
  CHECK (artifact_id <> source_artifact_id)
) STRICT, WITHOUT ROWID;

CREATE TABLE qa_results (
  qa_result_id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
  qa_kind TEXT NOT NULL CHECK (qa_kind IN ('print', 'style')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'needs_review')),
  overall_score REAL CHECK (overall_score IS NULL OR overall_score BETWEEN 0.0 AND 1.0),
  artifact_id TEXT REFERENCES artifacts(artifact_id),
  created_at TEXT NOT NULL,
  UNIQUE (candidate_id, qa_kind)
) STRICT;

CREATE TABLE reviews (
  review_id TEXT PRIMARY KEY,
  page_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (page_id, candidate_id) REFERENCES candidates(page_id, candidate_id)
) STRICT;

CREATE UNIQUE INDEX one_approval_per_page_idx
  ON reviews(page_id) WHERE decision = 'approved';

CREATE TABLE canonical_references (
  canonical_reference_id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL UNIQUE REFERENCES reviews(review_id),
  candidate_id TEXT NOT NULL REFERENCES candidates(candidate_id),
  style_pack_version TEXT NOT NULL,
  style_pack_revision INTEGER NOT NULL CHECK (style_pack_revision > 0),
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  promoted_by TEXT NOT NULL,
  promoted_at TEXT NOT NULL,
  retired_at TEXT,
  UNIQUE (style_pack_version, style_pack_revision, candidate_id)
) STRICT;

CREATE TABLE audit_events (
  audit_event_id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES book_runs(run_id),
  page_id TEXT REFERENCES pages(page_id),
  operation_id TEXT REFERENCES operations(operation_id),
  event_kind TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('system', 'workflow', 'provider', 'reviewer')),
  actor_id TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX book_runs_book_id_idx ON book_runs(book_id);
CREATE INDEX photos_run_id_idx ON photos(run_id);
CREATE INDEX pages_run_state_idx ON pages(run_id, state);
CREATE INDEX operations_run_page_idx ON operations(run_id, page_id);
CREATE INDEX provider_attempts_run_id_idx ON provider_attempts(run_id);
CREATE INDEX candidates_page_id_idx ON candidates(page_id);
CREATE INDEX artifacts_run_page_idx ON artifacts(run_id, page_id);
CREATE INDEX qa_results_candidate_id_idx ON qa_results(candidate_id);
CREATE INDEX audit_events_run_id_idx ON audit_events(run_id, created_at);

CREATE TRIGGER pages_initial_state_guard
BEFORE INSERT ON pages
WHEN NEW.state <> 'created'
BEGIN
  SELECT RAISE(ABORT, 'page_must_start_created');
END;

CREATE TRIGGER pages_approved_requires_evidence
BEFORE UPDATE OF state, approved_candidate_id, approval_source ON pages
WHEN NEW.state = 'approved' AND NOT (
  (
    NEW.approval_source = 'automatic' AND EXISTS (
      SELECT 1 FROM candidates c
      JOIN qa_results p ON p.candidate_id = c.candidate_id AND p.qa_kind = 'print' AND p.status = 'passed'
      JOIN qa_results s ON s.candidate_id = c.candidate_id AND s.qa_kind = 'style' AND s.status = 'passed'
      WHERE c.page_id = NEW.page_id AND c.candidate_id = NEW.approved_candidate_id
    )
  ) OR
  (
    NEW.approval_source = 'human' AND EXISTS (
      SELECT 1 FROM reviews
      WHERE page_id = NEW.page_id
        AND candidate_id = NEW.approved_candidate_id
        AND decision = 'approved'
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'approved_requires_qa_pass_or_human_review');
END;

CREATE TRIGGER pages_state_transition_guard
BEFORE UPDATE OF state ON pages
WHEN OLD.state <> NEW.state AND NOT (
  (OLD.state = 'created' AND NEW.state IN ('analyzing', 'intake_rejected', 'intake_needs_review', 'budget_exhausted')) OR
  (OLD.state = 'analyzing' AND NEW.state IN ('generating', 'intake_rejected', 'intake_needs_review', 'provider_failed', 'budget_exhausted')) OR
  (OLD.state = 'generating' AND NEW.state IN ('print_qa', 'provider_failed', 'budget_exhausted')) OR
  (OLD.state = 'print_qa' AND NEW.state IN ('style_qa', 'repairing', 'needs_human_review', 'provider_failed', 'budget_exhausted')) OR
  (OLD.state = 'style_qa' AND NEW.state IN ('approved', 'repairing', 'needs_human_review', 'provider_failed', 'budget_exhausted')) OR
  (OLD.state = 'repairing' AND NEW.state IN ('print_qa', 'needs_human_review', 'provider_failed', 'budget_exhausted')) OR
  (OLD.state = 'needs_human_review' AND NEW.state IN ('approved', 'rejected'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_page_state_transition');
END;

CREATE TRIGGER candidates_initial_limit
BEFORE INSERT ON candidates
WHEN NEW.generation_kind = 'initial' AND (
  SELECT count(*) FROM candidates WHERE page_id = NEW.page_id AND generation_kind = 'initial'
) >= 3
BEGIN
  SELECT RAISE(ABORT, 'initial_candidate_limit_exceeded');
END;

CREATE TRIGGER candidates_repair_round_limit
BEFORE INSERT ON candidates
WHEN NEW.generation_kind = 'repair' AND (
  SELECT count(*) FROM candidates WHERE repair_round_id = NEW.repair_round_id
) >= 2
BEGIN
  SELECT RAISE(ABORT, 'repair_round_candidate_limit_exceeded');
END;

CREATE TRIGGER candidates_count_initial
AFTER INSERT ON candidates
WHEN NEW.generation_kind = 'initial'
BEGIN
  UPDATE pages
  SET initial_candidate_count = initial_candidate_count + 1,
      updated_at = NEW.created_at
  WHERE page_id = NEW.page_id;
END;

CREATE TRIGGER repair_rounds_count
AFTER INSERT ON repair_rounds
BEGIN
  UPDATE pages
  SET repair_round_count = repair_round_count + 1,
      updated_at = NEW.created_at
  WHERE page_id = NEW.page_id;
END;

CREATE TRIGGER operations_terminal_page_guard
BEFORE INSERT ON operations
WHEN NEW.page_id IS NOT NULL
AND NEW.operation_kind NOT IN ('review', 'canonical_promotion')
AND NOT EXISTS (SELECT 1 FROM operations WHERE operation_id = NEW.operation_id)
AND EXISTS (
  SELECT 1 FROM pages
  WHERE page_id = NEW.page_id AND state IN (
    'intake_rejected', 'intake_needs_review', 'needs_human_review',
    'provider_failed', 'budget_exhausted', 'approved', 'rejected'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'terminal_page_cannot_start_operation');
END;

CREATE TRIGGER provider_attempts_cost_guard
BEFORE INSERT ON provider_attempts
WHEN (
  SELECT cost_spent_micros + NEW.estimated_cost_micros > cost_ceiling_micros
  FROM book_runs WHERE run_id = NEW.run_id
)
BEGIN
  SELECT RAISE(ABORT, 'book_run_cost_ceiling_exceeded');
END;

CREATE TRIGGER provider_attempts_semantic_counter_match
BEFORE INSERT ON provider_attempts
WHEN NEW.semantic_attempt <> (
  SELECT semantic_attempt FROM operations WHERE operation_id = NEW.operation_id
)
BEGIN
  SELECT RAISE(ABORT, 'semantic_attempt_mismatch');
END;

CREATE TRIGGER provider_attempts_count_infrastructure_retry
AFTER INSERT ON provider_attempts
BEGIN
  UPDATE operations
  SET infrastructure_retry_count = max(infrastructure_retry_count, NEW.infrastructure_attempt),
      updated_at = NEW.started_at
  WHERE operation_id = NEW.operation_id;
END;

CREATE TRIGGER provider_attempts_charge_run
AFTER UPDATE OF actual_cost_micros ON provider_attempts
WHEN OLD.actual_cost_micros IS NULL AND NEW.actual_cost_micros IS NOT NULL
BEGIN
  UPDATE book_runs
  SET cost_spent_micros = cost_spent_micros + NEW.actual_cost_micros,
      updated_at = coalesce(NEW.completed_at, NEW.started_at)
  WHERE run_id = NEW.run_id;
END;

CREATE TRIGGER reviews_append_only_update
BEFORE UPDATE ON reviews
BEGIN
  SELECT RAISE(ABORT, 'reviews_are_append_only');
END;

CREATE TRIGGER reviews_append_only_delete
BEFORE DELETE ON reviews
BEGIN
  SELECT RAISE(ABORT, 'reviews_are_append_only');
END;

CREATE TRIGGER canonical_requires_approved_review
BEFORE INSERT ON canonical_references
WHEN NOT EXISTS (
  SELECT 1 FROM reviews
  WHERE review_id = NEW.review_id
    AND candidate_id = NEW.candidate_id
    AND decision = 'approved'
)
BEGIN
  SELECT RAISE(ABORT, 'canonical_promotion_requires_approved_review');
END;
