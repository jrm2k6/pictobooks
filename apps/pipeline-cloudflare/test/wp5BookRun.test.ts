import { env } from "cloudflare:workers";
import { applyD1Migrations, reset, type D1Migration } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ProductionBookRun,
  type ImageArtifactResult,
  type ImageOperationInput,
  type ImageProcessor,
  type WorkflowSteps,
} from "../src/wp5/bookRun.js";
import { createSyntheticBookRun } from "../src/wp5/syntheticBookRun.js";
import { LocalMockImageProcessor } from "../src/wp5/localMockImageProcessor.js";

class ImmediateSteps implements WorkflowSteps {
  readonly names: string[] = [];

  async do<T extends Rpc.Serializable<T>>(
    name: string,
    configOrCallback: WorkflowStepConfig | (() => Promise<T>),
    maybeCallback?: () => Promise<T>
  ): Promise<T> {
    this.names.push(name);
    const callback =
      typeof configOrCallback === "function" ? configOrCallback : maybeCallback;
    if (!callback) throw new Error(`Missing callback for ${name}`);
    return callback();
  }
}

class FakeImageProcessor implements ImageProcessor {
  cleanup(input: ImageOperationInput): Promise<ImageArtifactResult> {
    return this.write(
      input,
      "image/png",
      new TextEncoder().encode(`clean:${input.input.sha256}`)
    );
  }

  printQa(input: ImageOperationInput): Promise<ImageArtifactResult> {
    const assessment = {
      status: "passed" as const,
      score: 1,
      widthPx: 2480,
      heightPx: 3508,
      isCorrectAspectRatio: true,
      isBlackAndWhiteOnly: true,
      blackPixelRatio: 0.1,
      whitePixelRatio: 0.9,
      grayPixelRatio: 0,
    };
    return this.write(
      input,
      "application/json",
      new TextEncoder().encode(JSON.stringify({ assessment })),
      assessment
    );
  }

  private async write(
    input: ImageOperationInput,
    mimeType: "image/png" | "application/json",
    body: Uint8Array,
    assessment?: ImageArtifactResult["assessment"]
  ): Promise<ImageArtifactResult> {
    const digest = await crypto.subtle.digest("SHA-256", body);
    const sha256 = Array.from(new Uint8Array(digest), value =>
      value.toString(16).padStart(2, "0")
    ).join("");
    await env.PIPELINE_ARTIFACTS.put(input.output.objectKey, body, {
      httpMetadata: { contentType: mimeType },
      customMetadata: {
        artifactid: input.output.artifactId,
        sha256,
        schemaversion: "2026-11-08",
      },
      sha256: digest,
    });
    return {
      operationId: input.operationId,
      status: "created",
      artifact: {
        artifactId: input.output.artifactId,
        objectKey: input.output.objectKey,
        sourceArtifactId: input.input.artifactId,
        sha256,
        byteSize: body.byteLength,
        mimeType,
      },
      assessment,
    };
  }
}

describe("WP5 ProductionBookRun", () => {
  beforeEach(async () => {
    await reset();
    const migrations = Reflect.get(env, "TEST_MIGRATIONS") as D1Migration[];
    await applyD1Migrations(env.PIPELINE_DB, migrations);
  });

  it("repairs once, approves on dual QA, and replays without charges or Candidates", async () => {
    const created = await createSyntheticBookRun(env, {
      pageCount: 1,
      executionProfile: "mock_pass_after_repair",
    });
    const pipeline = new ProductionBookRun(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeImageProcessor(),
      () => "2026-11-10T12:00:00.000Z"
    );
    const first = await pipeline.run(created.runId, new ImmediateSteps());

    expect(first.status).toBe("completed");
    expect(await scalar("SELECT count(*) FROM candidates")).toBe(5);
    expect(await scalar("SELECT count(*) FROM provider_attempts")).toBe(2);
    expect(await scalar("SELECT cost_spent_micros FROM book_runs")).toBe(5_000);
    expect(await scalar("SELECT repair_round_count FROM pages")).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'approved' AND approval_source = 'automatic'"
      )
    ).toBe(1);

    const replay = await pipeline.run(created.runId, new ImmediateSteps());
    expect(replay.status).toBe("completed");
    expect(await scalar("SELECT count(*) FROM candidates")).toBe(5);
    expect(await scalar("SELECT count(*) FROM provider_attempts")).toBe(2);
    expect(await scalar("SELECT cost_spent_micros FROM book_runs")).toBe(5_000);
  });

  it("completes a mock page run using only the local R2 image processor", async () => {
    const created = await createSyntheticBookRun(env, {
      pageCount: 1,
      executionProfile: "mock_pass_initial",
    });
    const pipeline = new ProductionBookRun(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new LocalMockImageProcessor(env.PIPELINE_ARTIFACTS),
      () => "2026-11-10T12:00:00.000Z"
    );

    const result = await pipeline.run(created.runId, new ImmediateSteps());

    expect(result.status).toBe("completed");
    expect(
      await scalar("SELECT count(*) FROM pages WHERE state = 'approved'")
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM artifacts WHERE mime_type = 'image/svg+xml'"
      )
    ).toBeGreaterThan(0);
  });

  it("stops after the second Repair Round", async () => {
    const created = await createSyntheticBookRun(env, {
      pageCount: 1,
      executionProfile: "mock_never_pass",
    });
    const pipeline = new ProductionBookRun(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeImageProcessor(),
      () => "2026-11-10T12:00:00.000Z"
    );

    const result = await pipeline.run(created.runId, new ImmediateSteps());

    expect(result.status).toBe("partially_completed");
    expect(await scalar("SELECT count(*) FROM candidates")).toBe(7);
    expect(await scalar("SELECT count(*) FROM repair_rounds")).toBe(2);
    expect(await scalar("SELECT count(*) FROM provider_attempts")).toBe(3);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'needs_human_review' AND terminal_reason = 'maximum_rounds_reached'"
      )
    ).toBe(1);
  });

  it("stops before provider submission when the cost ceiling is insufficient", async () => {
    const created = await createSyntheticBookRun(env, {
      pageCount: 1,
      executionProfile: "mock_pass_initial",
    });
    await env.PIPELINE_DB.prepare(
      "UPDATE book_runs SET cost_ceiling_micros = 2999 WHERE run_id = ?"
    )
      .bind(created.runId)
      .run();
    const pipeline = new ProductionBookRun(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeImageProcessor(),
      () => "2026-11-10T12:00:00.000Z"
    );

    const result = await pipeline.run(created.runId, new ImmediateSteps());

    expect(result.status).toBe("partially_completed");
    expect(await scalar("SELECT count(*) FROM provider_attempts")).toBe(0);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'budget_exhausted'"
      )
    ).toBe(1);
  });

  it("records an infrastructure failure as terminal review state", async () => {
    const created = await createSyntheticBookRun(env, {
      pageCount: 1,
      executionProfile: "mock_pass_initial",
    });
    const pipeline = new ProductionBookRun(
      env.PIPELINE_DB,
      env.PIPELINE_ARTIFACTS,
      new FakeImageProcessor(),
      () => "2026-11-10T12:00:00.000Z"
    );
    await env.PIPELINE_DB.prepare(
      "UPDATE book_runs SET status = 'running' WHERE run_id = ?"
    )
      .bind(created.runId)
      .run();
    await env.PIPELINE_DB.prepare(
      "UPDATE pages SET state = 'analyzing' WHERE run_id = ?"
    )
      .bind(created.runId)
      .run();
    await env.PIPELINE_DB.prepare(
      "UPDATE pages SET state = 'generating' WHERE run_id = ?"
    )
      .bind(created.runId)
      .run();

    await pipeline.failRun(created.runId, "workflow_step_failed");

    expect(
      await scalar("SELECT count(*) FROM book_runs WHERE status = 'failed'")
    ).toBe(1);
    expect(
      await scalar(
        "SELECT count(*) FROM pages WHERE state = 'provider_failed' AND terminal_reason = 'workflow_step_failed'"
      )
    ).toBe(1);
  });
});

const scalar = async (query: string): Promise<number> => {
  const row =
    await env.PIPELINE_DB.prepare(query).first<Record<string, number>>();
  if (!row) throw new Error(`No row returned for ${query}`);
  return Object.values(row)[0] ?? 0;
};
