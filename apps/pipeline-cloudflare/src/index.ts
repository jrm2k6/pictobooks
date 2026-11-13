import {
  DurableObject,
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
  type WorkflowStepConfig,
} from "cloudflare:workers";
import {
  ProductionBookRun,
  type ExecutionProfile,
  type WorkflowSteps,
} from "./wp5/bookRun.js";
import { ContainerImageProcessor } from "./wp5/containerImageProcessor.js";
import { LocalMockImageProcessor } from "./wp5/localMockImageProcessor.js";
import {
  createSyntheticBookRun,
  readBookRunStatus,
} from "./wp5/syntheticBookRun.js";
import { handleApiRequest, type RuntimeEnv } from "./api/router.js";

const CONTAINER_PORT = 8790;
const CONTAINER_INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const NORMALIZE_SCHEMA_VERSION = "2026-11-08";

export class ImageContainer extends DurableObject<Env> {
  private starting: Promise<void> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const container = ctx.container;
    if (!container) throw new Error("Image Container binding is missing");
    if (container.running) {
      void ctx.blockConcurrencyWhile(() =>
        container.setInactivityTimeout(CONTAINER_INACTIVITY_TIMEOUT_MS)
      );
    }
  }

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(CONTAINER_PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: true,
        env: {
          R2_ENDPOINT: requiredEnv(this.env, "R2_ENDPOINT"),
          R2_BUCKET: requiredEnv(this.env, "R2_BUCKET"),
          R2_ACCESS_KEY_ID: requiredEnv(this.env, "R2_ACCESS_KEY_ID"),
          R2_SECRET_ACCESS_KEY: requiredEnv(this.env, "R2_SECRET_ACCESS_KEY"),
        },
      });
    }
    await container.setInactivityTimeout(CONTAINER_INACTIVITY_TIMEOUT_MS);

    const port = container.getTcpPort(CONTAINER_PORT);
    let lastError: unknown;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const response = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (!response.ok) {
          throw new Error(`Container health check returned ${response.status}`);
        }
        return;
      } catch (error) {
        lastError = error;
        await scheduler.wait(200);
      }
    }
    throw new Error("Image Container did not become ready", {
      cause: lastError,
    });
  }
}

type BookRunParams = {
  runId: string;
  sourceId: string;
};

type ExistingArtifact = {
  artifact_id: string;
  object_key: string;
  sha256: string;
  byte_size: number;
};

type NormalizeResult = {
  schemaVersion: typeof NORMALIZE_SCHEMA_VERSION;
  operationId: string;
  status: "created" | "reused";
  artifact: {
    artifactId: string;
    objectKey: string;
    sourceArtifactId: string;
    sha256: string;
    byteSize: number;
    mimeType: "image/png";
    widthPx: number;
    heightPx: number;
  };
};

const json = (body: unknown, status = 200): Response =>
  Response.json(body, { status });

const sha256 = async (body: ArrayBuffer): Promise<string> => {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest), byte =>
    byte.toString(16).padStart(2, "0")
  ).join("");
};

const sourceKey = (sourceId: string): string =>
  `spike/sources/${sourceId}/source`;

const outputKey = (runId: string): string =>
  `spike/runs/${runId}/normalized.png`;

const isSafeId = (value: string): boolean =>
  /^[a-zA-Z0-9_-]{1,100}$/.test(value);

const invokeNormalize = async (
  env: Env,
  pageId: string,
  operation: {
    operationId: string;
    input: { artifactId: string; objectKey: string; sha256: string };
    output: { artifactId: string; objectKey: string };
  }
): Promise<NormalizeResult> => {
  const imageContainer = env.IMAGE_CONTAINER.getByName(`page-${pageId}`);
  const response = await imageContainer.fetch(
    "http://container/v1/operations/normalize",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: NORMALIZE_SCHEMA_VERSION,
        ...operation,
      }),
    }
  );
  if (!response.ok) {
    throw new Error(`Image worker failed with status ${response.status}`);
  }
  return response.json<NormalizeResult>();
};

export class BookRunWorkflow extends WorkflowEntrypoint<Env, BookRunParams> {
  async run(event: WorkflowEvent<BookRunParams>, step: WorkflowStep) {
    const { runId, sourceId } = event.payload;
    const operationId = `normalize:${runId}`;

    const claim = await step.do("claim normalization", async () => {
      const existing = await this.env.PIPELINE_DB.prepare(
        `SELECT a.artifact_id, a.object_key, a.sha256, a.byte_size
         FROM spike_operations o
         JOIN spike_artifacts a ON a.artifact_id = o.artifact_id
         WHERE o.operation_id = ? AND o.status = 'completed'`
      )
        .bind(operationId)
        .first<ExistingArtifact>();

      if (existing) return { reused: true, artifact: existing };

      const now = new Date().toISOString();
      await this.env.PIPELINE_DB.batch([
        this.env.PIPELINE_DB.prepare(
          "UPDATE spike_runs SET status = 'running', updated_at = ? WHERE run_id = ?"
        ).bind(now, runId),
        this.env.PIPELINE_DB.prepare(
          `INSERT INTO spike_operations (operation_id, run_id, status, created_at, updated_at)
           VALUES (?, ?, 'claimed', ?, ?)
           ON CONFLICT(operation_id) DO NOTHING`
        ).bind(operationId, runId, now, now),
      ]);

      return { reused: false, artifact: null };
    });

    if (claim.reused) return claim.artifact;

    return step.do(
      "normalize source",
      { retries: { limit: 3, delay: "2 seconds", backoff: "exponential" } },
      async () => {
        const alreadyCompleted = await this.env.PIPELINE_DB.prepare(
          `SELECT a.artifact_id, a.object_key, a.sha256, a.byte_size
           FROM spike_operations o
           JOIN spike_artifacts a ON a.artifact_id = o.artifact_id
           WHERE o.operation_id = ? AND o.status = 'completed'`
        )
          .bind(operationId)
          .first<ExistingArtifact>();
        if (alreadyCompleted) return alreadyCompleted;

        const source = await this.env.PIPELINE_ARTIFACTS.head(
          sourceKey(sourceId)
        );
        if (!source) throw new Error(`Source ${sourceId} is missing`);
        const sourceSha256 = source.customMetadata?.sha256;
        if (!sourceSha256) {
          throw new Error(`Source ${sourceId} has no Artifact checksum`);
        }

        const artifactId = `normalized:${runId}`;
        const objectKey = outputKey(runId);

        const normalized = await invokeNormalize(this.env, runId, {
          operationId,
          input: {
            artifactId: `source:${sourceId}`,
            objectKey: sourceKey(sourceId),
            sha256: sourceSha256,
          },
          output: { artifactId, objectKey },
        });
        if (
          normalized.operationId !== operationId ||
          normalized.artifact.artifactId !== artifactId ||
          normalized.artifact.objectKey !== objectKey ||
          normalized.artifact.sourceArtifactId !== `source:${sourceId}`
        ) {
          throw new Error("Image worker returned mismatched Artifact metadata");
        }
        const output = await this.env.PIPELINE_ARTIFACTS.head(objectKey);
        if (
          !output ||
          output.size !== normalized.artifact.byteSize ||
          output.customMetadata?.sha256 !== normalized.artifact.sha256
        ) {
          throw new Error("Normalized Artifact was not durably written to R2");
        }
        const now = new Date().toISOString();

        await this.env.PIPELINE_DB.batch([
          this.env.PIPELINE_DB.prepare(
            `INSERT INTO spike_artifacts
             (artifact_id, run_id, object_key, artifact_kind, sha256, byte_size, content_type, created_at)
             VALUES (?, ?, ?, 'normalized_source', ?, ?, 'image/png', ?)
             ON CONFLICT(artifact_id) DO NOTHING`
          ).bind(
            artifactId,
            runId,
            objectKey,
            normalized.artifact.sha256,
            normalized.artifact.byteSize,
            now
          ),
          this.env.PIPELINE_DB.prepare(
            `UPDATE spike_operations SET status = 'completed', artifact_id = ?, updated_at = ?
             WHERE operation_id = ?`
          ).bind(artifactId, now, operationId),
          this.env.PIPELINE_DB.prepare(
            `UPDATE spike_runs SET status = 'completed', output_artifact_id = ?, updated_at = ?
             WHERE run_id = ?`
          ).bind(artifactId, now, runId),
        ]);

        return {
          artifact_id: artifactId,
          object_key: objectKey,
          sha256: normalized.artifact.sha256,
          byte_size: normalized.artifact.byteSize,
        };
      }
    );
  }
}

type ProductionBookRunParams = { runId: string };

export class ProductionBookRunWorkflow extends WorkflowEntrypoint<
  Env,
  ProductionBookRunParams
> {
  async run(event: WorkflowEvent<ProductionBookRunParams>, step: WorkflowStep) {
    const runtimeConfig = this.env as Env & {
      LOCAL_CUSTOMER_API?: string;
      IMAGE_PROVIDER?: string;
    };
    const pipeline = new ProductionBookRun(
      this.env.PIPELINE_DB,
      this.env.PIPELINE_ARTIFACTS,
      runtimeConfig.LOCAL_CUSTOMER_API === "true" &&
      runtimeConfig.IMAGE_PROVIDER !== "gemini"
        ? new LocalMockImageProcessor(this.env.PIPELINE_ARTIFACTS)
        : new ContainerImageProcessor(this.env.IMAGE_CONTAINER),
      undefined,
      { apiKey: (this.env as Env & { GEMINI_API_KEY?: string }).GEMINI_API_KEY }
    );
    const steps = new CloudflareWorkflowSteps(step);
    try {
      return await pipeline.run(event.payload.runId, steps);
    } catch (error) {
      await steps.do(`fail run ${event.payload.runId}`, () =>
        pipeline.failRun(event.payload.runId, "workflow_step_failed")
      );
      throw error;
    }
  }
}

class CloudflareWorkflowSteps implements WorkflowSteps {
  constructor(private readonly step: WorkflowStep) {}

  do<T extends Rpc.Serializable<T>>(
    name: string,
    callback: () => Promise<T>
  ): Promise<T>;
  do<T extends Rpc.Serializable<T>>(
    name: string,
    config: WorkflowStepConfig,
    callback: () => Promise<T>
  ): Promise<T>;
  do<T extends Rpc.Serializable<T>>(
    name: string,
    configOrCallback: WorkflowStepConfig | (() => Promise<T>),
    maybeCallback?: () => Promise<T>
  ): Promise<T> {
    if (typeof configOrCallback === "function") {
      return this.step.do(name, async () => configOrCallback());
    }
    if (!maybeCallback)
      throw new Error(`Workflow step ${name} has no callback`);
    return this.step.do(name, configOrCallback, async () => maybeCallback());
  }
}

const handleRequest = async (request: Request, env: Env): Promise<Response> => {
  const url = new URL(request.url);
  const apiResponse = await handleApiRequest(request, env as RuntimeEnv);
  if (apiResponse) return apiResponse;
  const sourceMatch = url.pathname.match(/^\/spike\/sources\/([^/]+)$/);
  const runMatch = url.pathname.match(/^\/spike\/runs\/([^/]+)$/);

  if (
    request.method === "POST" &&
    url.pathname === "/internal/smoke/image-normalize"
  ) {
    return handleImageNormalizeSmoke(request, env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/internal/synthetic-book-runs"
  ) {
    const unauthorized = await internalAuthorizationFailure(request, env);
    if (unauthorized) return unauthorized;
    const body = await request.json<{
      pageCount?: number;
      executionProfile?: ExecutionProfile;
    }>();
    const executionProfile = body.executionProfile ?? "mock_pass_after_repair";
    if (
      ![
        "mock_pass_initial",
        "mock_pass_after_repair",
        "mock_never_pass",
      ].includes(executionProfile)
    ) {
      return json({ error: "invalid_execution_profile" }, 400);
    }
    const created = await createSyntheticBookRun(env, {
      pageCount: body.pageCount ?? 1,
      executionProfile,
    });
    await env.PRODUCTION_BOOK_RUN_WORKFLOW.create({
      id: created.runId,
      params: { runId: created.runId },
    });
    return json(created, 202);
  }

  const syntheticRunMatch = url.pathname.match(
    /^\/internal\/synthetic-book-runs\/([^/]+)$/
  );
  if (request.method === "GET" && syntheticRunMatch) {
    const unauthorized = await internalAuthorizationFailure(request, env);
    if (unauthorized) return unauthorized;
    const runId = syntheticRunMatch[1] ?? "";
    if (!isSafeId(runId)) return json({ error: "invalid_run_id" }, 400);
    const data = await readBookRunStatus(env, runId);
    if (!data) return json({ error: "run_not_found" }, 404);
    const instance = await env.PRODUCTION_BOOK_RUN_WORKFLOW.get(runId);
    return json({ ...data, workflow: await instance.status() });
  }

  if (request.method === "PUT" && sourceMatch) {
    const sourceId = sourceMatch[1] ?? "";
    if (!isSafeId(sourceId)) return json({ error: "invalid_source_id" }, 400);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (
      !request.body ||
      !Number.isSafeInteger(contentLength) ||
      contentLength <= 0 ||
      contentLength > MAX_SOURCE_BYTES
    ) {
      return json({ error: "non_empty_body_required" }, 400);
    }

    const objectKey = sourceKey(sourceId);
    const sourceBody = await request.arrayBuffer();
    if (sourceBody.byteLength !== contentLength) {
      return json({ error: "content_length_mismatch" }, 400);
    }
    const digest = await sha256(sourceBody);
    await env.PIPELINE_ARTIFACTS.put(objectKey, sourceBody, {
      httpMetadata: {
        contentType:
          request.headers.get("content-type") ?? "application/octet-stream",
      },
      customMetadata: { artifactId: `source:${sourceId}`, sha256: digest },
    });
    const object = await env.PIPELINE_ARTIFACTS.head(objectKey);
    const now = new Date().toISOString();
    await env.PIPELINE_DB.prepare(
      `INSERT INTO spike_sources (source_id, object_key, content_type, byte_size, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(source_id) DO UPDATE SET
         object_key = excluded.object_key,
         content_type = excluded.content_type,
         byte_size = excluded.byte_size`
    )
      .bind(
        sourceId,
        objectKey,
        object?.httpMetadata?.contentType ?? "application/octet-stream",
        object?.size ?? contentLength,
        now
      )
      .run();
    return json({ sourceId, objectKey, sha256: digest }, 201);
  }

  if (runMatch && request.method === "POST") {
    const runId = runMatch[1] ?? "";
    if (!isSafeId(runId)) return json({ error: "invalid_run_id" }, 400);
    const body = await request.json<{ sourceId?: string }>();
    const sourceId = body.sourceId ?? "";
    if (!isSafeId(sourceId)) return json({ error: "invalid_source_id" }, 400);
    const source = await env.PIPELINE_DB.prepare(
      "SELECT source_id FROM spike_sources WHERE source_id = ?"
    )
      .bind(sourceId)
      .first();
    if (!source) return json({ error: "source_not_found" }, 404);

    const now = new Date().toISOString();
    const result = await env.PIPELINE_DB.prepare(
      `INSERT INTO spike_runs (run_id, source_id, status, created_at, updated_at)
       VALUES (?, ?, 'created', ?, ?)
       ON CONFLICT(run_id) DO NOTHING`
    )
      .bind(runId, sourceId, now, now)
      .run();
    if (result.meta.changes > 0) {
      await env.BOOK_RUN_WORKFLOW.create({
        id: runId,
        params: { runId, sourceId },
      });
    }
    return json({ runId, sourceId, created: result.meta.changes > 0 }, 202);
  }

  if (runMatch && request.method === "GET") {
    const runId = runMatch[1] ?? "";
    if (!isSafeId(runId)) return json({ error: "invalid_run_id" }, 400);
    const run = await env.PIPELINE_DB.prepare(
      "SELECT * FROM spike_runs WHERE run_id = ?"
    )
      .bind(runId)
      .first();
    if (!run) return json({ error: "run_not_found" }, 404);
    const instance = await env.BOOK_RUN_WORKFLOW.get(runId);
    const workflow = await instance.status();
    return json({ run, workflow });
  }

  return json({ error: "not_found" }, 404);
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "spike request failed",
          path: new URL(request.url).pathname,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      return json({ error: "internal_error" }, 500);
    }
  },
} satisfies ExportedHandler<Env>;

function requiredEnv(env: Env, name: string): string {
  const value = Reflect.get(env, name);
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const handleImageNormalizeSmoke = async (
  request: Request,
  env: Env
): Promise<Response> => {
  const requestUrl = new URL(request.url);
  const downloadOutput = requestUrl.searchParams.get("download") === "true";
  if (readOptionalEnv(env, "SMOKE_TESTS_ENABLED") !== "true") {
    return json({ error: "not_found" }, 404);
  }
  const token = readOptionalEnv(env, "SMOKE_TEST_TOKEN");
  const authorization = request.headers.get("authorization");
  if (
    !token ||
    !authorization?.startsWith("Bearer ") ||
    !(await secureEqual(authorization.slice(7), token))
  ) {
    return json({ error: "unauthorized" }, 401);
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (
    !request.body ||
    !Number.isSafeInteger(contentLength) ||
    contentLength <= 0 ||
    contentLength > MAX_SOURCE_BYTES
  ) {
    return json({ error: "invalid_content_length" }, 400);
  }

  const body = await request.arrayBuffer();
  if (body.byteLength !== contentLength) {
    return json({ error: "content_length_mismatch" }, 400);
  }

  const smokeId = crypto.randomUUID();
  const prefix = `smoke/image-normalize/${smokeId}`;
  const inputKey = `${prefix}/source`;
  const outputKey = `${prefix}/normalized.png`;
  const operationId = `smoke:${smokeId}`;
  const sourceArtifactId = `smoke-source:${smokeId}`;
  const outputArtifactId = `smoke-normalized:${smokeId}`;
  const digest = await sha256(body);

  try {
    await env.PIPELINE_ARTIFACTS.put(inputKey, body, {
      httpMetadata: {
        contentType:
          request.headers.get("content-type") ?? "application/octet-stream",
      },
      customMetadata: { artifactId: sourceArtifactId, sha256: digest },
    });
    const operation = {
      operationId,
      input: {
        artifactId: sourceArtifactId,
        objectKey: inputKey,
        sha256: digest,
      },
      output: { artifactId: outputArtifactId, objectKey: outputKey },
    };
    const first = await invokeNormalize(env, smokeId, operation);
    const replay = await invokeNormalize(env, smokeId, operation);
    const output = await env.PIPELINE_ARTIFACTS.head(outputKey);
    if (
      replay.status !== "reused" ||
      first.artifact.sha256 !== replay.artifact.sha256 ||
      !output ||
      output.size !== replay.artifact.byteSize ||
      output.customMetadata?.sha256 !== replay.artifact.sha256
    ) {
      throw new Error("Remote replay or durable Artifact verification failed");
    }
    if (downloadOutput) {
      const outputObject = await env.PIPELINE_ARTIFACTS.get(outputKey);
      if (!outputObject) {
        throw new Error("Normalized Artifact disappeared before download");
      }
      const outputBody = await outputObject.arrayBuffer();
      if ((await sha256(outputBody)) !== replay.artifact.sha256) {
        throw new Error(
          "Downloaded normalized Artifact checksum does not match"
        );
      }
      return new Response(outputBody, {
        headers: {
          "Content-Type": "image/png",
          "Content-Length": String(outputBody.byteLength),
          "X-Pictobook-Smoke-Id": smokeId,
          "X-Pictobook-First-Status": first.status,
          "X-Pictobook-Replay-Status": replay.status,
          "X-Pictobook-Artifact-Sha256": replay.artifact.sha256,
          "X-Pictobook-Artifact-Width": String(replay.artifact.widthPx),
          "X-Pictobook-Artifact-Height": String(replay.artifact.heightPx),
          "X-Pictobook-Remote-Cleanup": "complete",
        },
      });
    }
    return json({
      ok: true,
      smokeId,
      firstStatus: first.status,
      replayStatus: replay.status,
      artifact: replay.artifact,
      cleanedUp: true,
    });
  } finally {
    await Promise.all([
      env.PIPELINE_ARTIFACTS.delete(inputKey),
      env.PIPELINE_ARTIFACTS.delete(outputKey),
    ]);
  }
};

const internalAuthorizationFailure = async (
  request: Request,
  env: Env
): Promise<Response | null> => {
  if (readOptionalEnv(env, "SMOKE_TESTS_ENABLED") !== "true") {
    return json({ error: "not_found" }, 404);
  }
  const token = readOptionalEnv(env, "SMOKE_TEST_TOKEN");
  const authorization = request.headers.get("authorization");
  if (
    !token ||
    !authorization?.startsWith("Bearer ") ||
    !(await secureEqual(authorization.slice(7), token))
  ) {
    return json({ error: "unauthorized" }, 401);
  }
  return null;
};

const readOptionalEnv = (env: Env, name: string): string | undefined => {
  const value = Reflect.get(env, name);
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

const secureEqual = async (left: string, right: string): Promise<boolean> => {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let difference = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index]! ^ rightBytes[index]!;
  }
  return difference === 0;
};
