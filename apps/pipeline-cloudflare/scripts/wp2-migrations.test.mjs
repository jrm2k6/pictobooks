import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const database = "pictobook-pipeline-spike-dev";
const wrangler = resolve("node_modules/.bin/wrangler");
const temporaryRoots = [];

const run = (args, expectedSuccess = true) => {
  const result = spawnSync(wrangler, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  const output = `${result.stdout}\n${result.stderr}`;
  if (expectedSuccess && result.status !== 0) {
    throw new Error(`Command failed: wrangler ${args.join(" ")}\n${output}`);
  }
  if (!expectedSuccess && result.status === 0) {
    throw new Error(`Command unexpectedly passed: wrangler ${args.join(" ")}`);
  }
  return output;
};

const execute = (persistTo, sql, expectedSuccess = true) =>
  run(
    [
      "d1",
      "execute",
      database,
      "--local",
      "--persist-to",
      persistTo,
      "--command",
      sql,
    ],
    expectedSuccess
  );

const createState = async () => {
  const root = await mkdtemp(join(tmpdir(), "pictobook-wp2-"));
  temporaryRoots.push(root);
  return root;
};

const now = "2026-11-07T00:00:00.000Z";

try {
  const emptyState = await createState();
  run([
    "d1",
    "migrations",
    "apply",
    database,
    "--local",
    "--persist-to",
    emptyState,
  ]);
  const tables = execute(
    emptyState,
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('books','pages','operations','spike_runs') ORDER BY name;"
  );
  for (const table of ["books", "operations", "pages", "spike_runs"]) {
    assert.match(tables, new RegExp(`\\b${table}\\b`));
  }

  const upgradedState = await createState();
  run([
    "d1",
    "execute",
    database,
    "--local",
    "--persist-to",
    upgradedState,
    "--file",
    "migrations/0001_spike.sql",
  ]);
  run([
    "d1",
    "execute",
    database,
    "--local",
    "--persist-to",
    upgradedState,
    "--file",
    "migrations/0002_pipeline_state.sql",
  ]);
  run([
    "d1",
    "execute",
    database,
    "--local",
    "--persist-to",
    upgradedState,
    "--file",
    "migrations/0003_book_run_execution.sql",
  ]);
  run([
    "d1",
    "execute",
    database,
    "--local",
    "--persist-to",
    upgradedState,
    "--file",
    "migrations/0004_authenticated_api.sql",
  ]);
  assert.match(
    execute(
      upgradedState,
      "SELECT name FROM sqlite_master WHERE name = 'spike_runs';"
    ),
    /spike_runs/
  );
  assert.match(
    execute(
      upgradedState,
      "SELECT name FROM sqlite_master WHERE name = 'api_sessions';"
    ),
    /api_sessions/
  );

  execute(
    emptyState,
    `INSERT INTO books VALUES ('book_1','owner_1','processing','${now}','${now}');
     INSERT INTO book_runs VALUES ('run_1','book_1','running','pictobook-preschool-v0.1',100,0,'${now}','${now}',NULL);
     INSERT INTO photos VALUES ('photo_1','run_1',1,NULL,'accepted','${now}');
     INSERT INTO pages
       (page_id,run_id,photo_id,state,initial_candidate_count,repair_round_count,approved_candidate_id,approval_source,terminal_reason,created_at,updated_at)
       VALUES ('page_1','run_1','photo_1','created',0,0,NULL,NULL,NULL,'${now}','${now}');
     UPDATE pages SET state = 'analyzing' WHERE page_id = 'page_1';
     UPDATE pages SET state = 'generating' WHERE page_id = 'page_1';
     INSERT INTO operations VALUES ('op_initial','run_1','page_1','generate_initial','completed',0,0,'{"candidate_ids":[]}',NULL,'${now}','${now}','${now}');
     INSERT INTO operations VALUES ('op_repair_1','run_1','page_1','generate_repair','completed',1,0,'{}',NULL,'${now}','${now}','${now}');
     INSERT INTO operations VALUES ('op_repair_2','run_1','page_1','generate_repair','completed',2,0,'{}',NULL,'${now}','${now}','${now}');
     INSERT INTO repair_rounds VALUES ('repair_1','page_1',1,2,NULL,'completed','regenerate_from_source','${now}','${now}');
     INSERT INTO repair_rounds VALUES ('repair_2','page_1',2,2,NULL,'completed','repair_candidate','${now}','${now}');
     INSERT INTO candidates VALUES ('candidate_1','page_1','op_initial',NULL,'initial',1,NULL,NULL,'${now}');
     INSERT INTO candidates VALUES ('candidate_2','page_1','op_initial',NULL,'initial',2,NULL,NULL,'${now}');
     INSERT INTO candidates VALUES ('candidate_3','page_1','op_initial',NULL,'initial',3,NULL,NULL,'${now}');
     INSERT INTO candidates VALUES ('candidate_4','page_1','op_repair_1','repair_1','repair',4,NULL,NULL,'${now}');
     INSERT INTO candidates VALUES ('candidate_5','page_1','op_repair_1','repair_1','repair',5,NULL,NULL,'${now}');
     INSERT INTO candidates VALUES ('candidate_6','page_1','op_repair_2','repair_2','repair',6,NULL,NULL,'${now}');
     INSERT INTO qa_results VALUES ('qa_print_1','candidate_1','print','passed',0.94,NULL,'${now}');
     INSERT INTO qa_results VALUES ('qa_style_2','candidate_2','style','passed',0.75,NULL,'${now}');
     UPDATE pages SET state = 'print_qa' WHERE page_id = 'page_1';
     UPDATE pages SET state = 'style_qa' WHERE page_id = 'page_1';`
  );

  // 1: readiness requires both passing gates on the same Candidate.
  assert.match(
    execute(
      emptyState,
      "UPDATE pages SET state = 'approved', approved_candidate_id = 'candidate_1', approval_source = 'automatic' WHERE page_id = 'page_1';",
      false
    ),
    /approved_requires_qa_pass_or_human_review/
  );
  execute(
    emptyState,
    `INSERT INTO qa_results VALUES ('qa_style_1','candidate_1','style','passed',0.75,NULL,'${now}');
     UPDATE pages SET state = 'approved', approved_candidate_id = 'candidate_1', approval_source = 'automatic' WHERE page_id = 'page_1';`
  );

  // 2: initial generation is capped at three Candidates.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO candidates VALUES ('candidate_initial_4','page_1','op_initial',NULL,'initial',7,NULL,NULL,'${now}');`,
      false
    ),
    /initial_candidate_limit_exceeded/
  );

  // 3: repair is capped at two rounds and two Candidates per round.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO repair_rounds VALUES ('repair_3','page_1',3,1,NULL,'claimed','repair_candidate','${now}',NULL);`,
      false
    ),
    /CHECK constraint failed/
  );
  assert.match(
    execute(
      emptyState,
      `INSERT INTO candidates VALUES ('candidate_repair_3','page_1','op_repair_1','repair_1','repair',7,NULL,NULL,'${now}');`,
      false
    ),
    /repair_round_candidate_limit_exceeded/
  );

  // 4: provider Infrastructure Retries are capped at three submissions.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO provider_attempts VALUES ('pa_4','op_initial','run_1','gemini','nano-banana',NULL,4,0,'claimed',0,NULL,'${now}',NULL);`,
      false
    ),
    /CHECK constraint failed/
  );

  // 5: semantic attempts cannot be smuggled in as Infrastructure Retries.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO provider_attempts VALUES ('pa_mismatch','op_initial','run_1','gemini','nano-banana','req-mismatch',1,1,'claimed',0,NULL,'${now}',NULL);`,
      false
    ),
    /semantic_attempt_mismatch/
  );

  // 6: the Book Run cost ceiling blocks a new provider submission.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO provider_attempts VALUES ('pa_cost','op_initial','run_1','gemini','nano-banana','req-cost',1,0,'claimed',101,NULL,'${now}',NULL);`,
      false
    ),
    /book_run_cost_ceiling_exceeded/
  );

  // 7: an Operation ID is a unique replay claim and keeps its recorded outcome.
  assert.match(
    execute(
      emptyState,
      `INSERT INTO operations VALUES ('op_initial','run_1','page_1','generate_initial','claimed',0,0,NULL,NULL,'${now}','${now}',NULL);`,
      false
    ),
    /UNIQUE constraint failed/
  );
  assert.match(
    execute(
      emptyState,
      "SELECT outcome_json FROM operations WHERE operation_id = 'op_initial';"
    ),
    /candidate_ids/
  );

  // 8: terminal pages cannot start another operation.
  assert.match(
    execute(
      emptyState,
      "UPDATE pages SET state = 'generating' WHERE page_id = 'page_1';",
      false
    ),
    /invalid_page_state_transition/
  );
  assert.match(
    execute(
      emptyState,
      `INSERT INTO operations VALUES ('op_after_terminal','run_1','page_1','style_qa','claimed',0,0,NULL,NULL,'${now}','${now}',NULL);`,
      false
    ),
    /terminal_page_cannot_start_operation/
  );
  execute(
    emptyState,
    `INSERT INTO operations VALUES ('op_review','run_1','page_1','review','claimed',0,0,NULL,NULL,'${now}','${now}',NULL);`
  );

  // 9: approval is append-only and names the exact Candidate.
  execute(
    emptyState,
    `INSERT INTO reviews VALUES ('review_1','page_1','candidate_1','reviewer_1','approved','looks good','${now}');`
  );
  assert.match(
    execute(
      emptyState,
      "UPDATE reviews SET notes = 'changed' WHERE review_id = 'review_1';",
      false
    ),
    /reviews_are_append_only/
  );

  execute(
    emptyState,
    `INSERT INTO photos VALUES ('photo_2','run_1',2,NULL,'accepted','${now}');
     INSERT INTO pages
       (page_id,run_id,photo_id,state,initial_candidate_count,repair_round_count,approved_candidate_id,approval_source,terminal_reason,created_at,updated_at)
       VALUES ('page_2','run_1','photo_2','created',0,0,NULL,NULL,NULL,'${now}','${now}');
     UPDATE pages SET state = 'analyzing' WHERE page_id = 'page_2';
     UPDATE pages SET state = 'generating' WHERE page_id = 'page_2';
     INSERT INTO operations VALUES ('op_page_2','run_1','page_2','generate_initial','completed',0,0,'{}',NULL,'${now}','${now}','${now}');
     INSERT INTO candidates VALUES ('candidate_7','page_2','op_page_2',NULL,'initial',1,NULL,NULL,'${now}');
     UPDATE pages SET state = 'print_qa' WHERE page_id = 'page_2';
     UPDATE pages SET state = 'style_qa' WHERE page_id = 'page_2';
     UPDATE pages SET state = 'needs_human_review' WHERE page_id = 'page_2';
     INSERT INTO reviews VALUES ('review_2','page_2','candidate_7','reviewer_1','approved','human exception','${now}');
     UPDATE pages SET state = 'approved', approved_candidate_id = 'candidate_7', approval_source = 'human' WHERE page_id = 'page_2';`
  );
  assert.match(
    execute(
      emptyState,
      "DELETE FROM reviews WHERE review_id = 'review_1';",
      false
    ),
    /reviews_are_append_only/
  );
  // 10: canonical promotion is explicit, approved, and revisioned.
  execute(
    emptyState,
    `INSERT INTO operations VALUES ('op_canonical','run_1','page_1','canonical_promotion','claimed',0,0,NULL,NULL,'${now}','${now}',NULL);`
  );
  execute(
    emptyState,
    `INSERT INTO artifacts VALUES ('artifact_1','run_1','page_1','op_initial','books/book_1/runs/run_1/pages/page_1/candidates/candidate_1/clean.png','candidate_clean','2026-11-07','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',1,'image/png','gemini','nano-banana','canonical',NULL,'${now}');`
  );
  assert.match(
    execute(
      emptyState,
      `INSERT INTO canonical_references VALUES ('canonical_bad','missing_review','candidate_1','pictobook-preschool-v0.1',1,'artifact_1','reviewer_1','${now}',NULL);`,
      false
    ),
    /FOREIGN KEY constraint failed|canonical_promotion_requires_approved_review/
  );
  execute(
    emptyState,
    `INSERT INTO canonical_references VALUES ('canonical_1','review_1','candidate_1','pictobook-preschool-v0.1',1,'artifact_1','reviewer_1','${now}',NULL);`
  );
} finally {
  await Promise.all(
    temporaryRoots.map(root => rm(root, { recursive: true, force: true }))
  );
}
