import { createServer, type IncomingMessage } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { loadPipelineEnv } from "./config/env.js";
import { createLogger } from "./io/logger.js";
import { resolveRunLabel } from "./io/runIdentity.js";
import { saveCandidateReview } from "./review/catalog.js";
import { regenerateCandidateFromSource } from "./style/sourceRegeneration.js";

type DashboardArgs = {
  run?: string;
  catalog?: string;
  port: number;
};

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type DashboardCandidate = {
  id: string;
  status: string;
  score: number | null;
  image_url: string | null;
  qa: Record<string, JsonValue>;
  repair: JsonValue | null;
  review: JsonValue | null;
  style_qa: JsonValue | null;
  effective_style_status: string;
  style_rank: number | null;
  origin: {
    kind: "original" | "auto_repair" | "source_regeneration";
    sequence: number | null;
    source_candidate_id: string | null;
  };
};

const parseArgs = (argv: string[]): DashboardArgs => {
  const args: DashboardArgs = { port: 4177 };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--") {
      continue;
    }
    if (arg === "--run") {
      args.run = value;
      index += 1;
    } else if (arg === "--catalog") {
      args.catalog = value;
      index += 1;
    } else if (arg === "--port") {
      args.port = Number(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));

  if (!args.run) {
    console.log(`Usage:
  pnpm --filter pipeline dashboard -- --run <run-dir> [--catalog <catalog-dir>] [--port 4177]`);
    process.exitCode = 1;
    return;
  }

  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  loadPipelineEnv({ invocationCwd });
  const runDir = resolve(invocationCwd, args.run);
  const catalogRoot = resolve(invocationCwd, args.catalog ?? "catalog");
  const logger = createLogger();
  const activeRegenerations = new Set<string>();

  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    try {
      if (url.pathname === "/") {
        response.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(renderHtml());
        return;
      }

      if (url.pathname === "/api/run") {
        const dashboardData = await buildDashboardData(runDir, catalogRoot);
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end(JSON.stringify(dashboardData));
        return;
      }

      if (url.pathname === "/api/reviews" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const review = await saveCandidateReview({
          runDir,
          catalogRoot,
          photoId: requiredString(payload, "photo_id"),
          candidateId: requiredString(payload, "candidate_id"),
          status: reviewStatus(payload["status"]),
          canonical: payload["canonical"] === true,
          notes: optionalString(payload["notes"]),
        });
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
        });
        response.end(JSON.stringify({ ok: true, review }));
        return;
      }

      if (url.pathname === "/api/regenerations" && request.method === "POST") {
        const payload = await readJsonBody(request);
        const photoId = requiredString(payload, "photo_id");
        const candidateId = requiredString(payload, "candidate_id");
        if (activeRegenerations.has(photoId)) {
          response.writeHead(409, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(
            JSON.stringify({ message: "This photo is already regenerating." })
          );
          return;
        }
        activeRegenerations.add(photoId);
        try {
          const regeneration = await regenerateCandidateFromSource({
            invocationCwd,
            runDir,
            catalogRoot,
            photoId,
            candidateId,
            reviewerInstruction: optionalString(payload["notes"]),
            logger,
          });
          response.writeHead(200, {
            "content-type": "application/json; charset=utf-8",
          });
          response.end(JSON.stringify({ ok: true, regeneration }));
        } finally {
          activeRegenerations.delete(photoId);
        }
        return;
      }

      if (url.pathname.startsWith("/artifact/")) {
        const relativePath = decodeURIComponent(
          url.pathname.replace("/artifact/", "")
        );
        const artifactPath = resolve(runDir, relativePath);

        if (!isInside(runDir, artifactPath)) {
          response.writeHead(403);
          response.end("Forbidden");
          return;
        }

        const body = await readFile(artifactPath);
        response.writeHead(200, {
          "content-type": contentTypeFor(artifactPath),
        });
        response.end(body);
        return;
      }

      response.writeHead(404);
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  server.listen(args.port, "127.0.0.1", () => {
    console.log(
      `[dashboard] http://127.0.0.1:${args.port} reading ${runDir}; catalogue ${catalogRoot}`
    );
  });
};

const buildDashboardData = async (runDir: string, catalogRoot: string) => {
  const run = await readJson(join(runDir, "run.json"));
  const runLabel = await resolveRunLabel(runDir);
  const photosRoot = join(runDir, "photos");
  const photoDirs = await readdir(photosRoot, { withFileTypes: true });

  const photos = [];
  for (const entry of photoDirs
    .filter(item => item.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const photoDir = join(photosRoot, entry.name);
    const candidatesDir = join(photoDir, "candidates");
    const photoAnalysis = await readJsonIfExists(
      join(photoDir, "photo-analysis.json")
    );
    const pageBrief = await readJsonIfExists(join(photoDir, "page-brief.json"));
    const selectedQa = await readJsonIfExists(
      join(photoDir, "selected.qa.json")
    );
    const selectedText = await readTextIfExists(join(photoDir, "selected.txt"));
    const autoStyleRepair = await readJsonIfExists(
      join(photoDir, "auto-style-repair.json")
    );
    const sourceRegenerations = await readJsonIfExists(
      join(photoDir, "source-regenerations.json")
    );
    const styleAcceptScore = numberValue(
      objectValue(objectValue(autoStyleRepair)?.["policy"])?.["accept_score"]
    );
    const candidateFiles = await readdir(candidatesDir).catch(() => []);
    const qaFiles = candidateFiles
      .filter(file => file.endsWith(".qa.json"))
      .sort();

    const candidates: DashboardCandidate[] = [];
    for (const qaFile of qaFiles) {
      const qa = objectValue(await readJson(join(candidatesDir, qaFile)));
      if (!qa) {
        continue;
      }
      const imagePath = stringValue(qa["generated_image_uri"]);
      const candidateId = stringValue(qa["candidate_id"]);
      const styleQa = await readJsonIfExists(
        join(candidatesDir, `${candidateId}.style-qa.json`)
      );
      const rawStyleStatus = stringValue(objectValue(styleQa)?.["status"]);
      const styleScore = numberValue(objectValue(styleQa)?.["overall_score"]);
      const effectiveStyleStatus =
        styleAcceptScore !== null &&
        styleScore !== null &&
        styleScore >= styleAcceptScore
          ? "passed"
          : rawStyleStatus;
      candidates.push({
        id: candidateId,
        status: stringValue(qa["status"]),
        score: numberValue(qa["overall_score"]),
        image_url: imagePath ? artifactUrl(runDir, imagePath) : null,
        qa,
        repair: await readJsonIfExists(
          join(candidatesDir, qaFile.replace(".qa.json", ".repair.json"))
        ),
        review: await readJsonIfExists(
          join(candidatesDir, `${candidateId}.review.json`)
        ),
        style_qa: styleQa,
        effective_style_status: effectiveStyleStatus,
        style_rank: null,
        origin: {
          kind: "original",
          sequence: null,
          source_candidate_id: null,
        },
      });
    }

    applyCandidateOrigins(candidates, autoStyleRepair, sourceRegenerations);

    const styleRanked = candidates
      .map(candidate => ({
        candidate,
        score: numberValue(objectValue(candidate.style_qa)?.["overall_score"]),
      }))
      .filter(
        (entry): entry is { candidate: DashboardCandidate; score: number } =>
          entry.score !== null
      )
      .sort((left, right) => right.score - left.score);
    styleRanked.forEach((entry, index) => {
      entry.candidate.style_rank = index + 1;
    });

    const approvedCandidate = candidates.find(candidate => {
      const review = objectValue(candidate.review);
      return stringValue(review?.["status"]) === "approved";
    });
    if (approvedCandidate) {
      const approvedIndex = candidates.indexOf(approvedCandidate);
      candidates.splice(approvedIndex, 1);
      candidates.unshift(approvedCandidate);
    }
    const reviewedCandidates = candidates.filter(candidate => candidate.review);
    const manualStatus = approvedCandidate
      ? "approved"
      : reviewedCandidates.length > 0
        ? reviewedCandidates.length === candidates.length &&
          candidates.length > 0
          ? "rejected"
          : "needs_review"
        : null;
    const printQaPassed = candidates.some(
      candidate => candidate.status === "passed"
    );
    const styleQaPassed = candidates.some(
      candidate =>
        candidate.status === "passed" &&
        candidate.effective_style_status === "passed"
    );
    const qaStatus =
      printQaPassed && styleQaPassed
        ? "print_and_style_passed"
        : printQaPassed
          ? "print_only"
          : "none_passed";

    photos.push({
      id: entry.name,
      display_id: `${runLabel} / ${entry.name}`,
      photo_dir: entry.name,
      status:
        manualStatus ??
        (stringValue(objectValue(selectedQa)?.["status"]) || "needs_review"),
      original_url: firstExistingArtifactUrl(runDir, photoDir, [
        "feature_upload.png",
        "normalized.png",
      ]),
      normalized_url: artifactUrl(runDir, join(photoDir, "normalized.png")),
      selected_url: selectedText
        ? artifactUrl(runDir, selectedText.trim())
        : null,
      approved_candidate_id: approvedCandidate?.id ?? null,
      approved_style_rank: approvedCandidate?.style_rank ?? null,
      style_qa_count: styleRanked.length,
      qa_status: qaStatus,
      print_qa_passed: printQaPassed,
      style_qa_passed: styleQaPassed,
      auto_style_repair: autoStyleRepair,
      photo_analysis: photoAnalysis,
      page_brief: pageBrief,
      selected_qa: selectedQa,
      candidates,
    });
  }

  return {
    run,
    run_label: runLabel,
    run_dir: runDir,
    run_dir_url: pathToFileURL(runDir).toString(),
    catalog_dir: catalogRoot,
    photos,
  };
};

const applyCandidateOrigins = (
  candidates: DashboardCandidate[],
  autoStyleRepair: JsonValue | null,
  sourceRegenerations: JsonValue | null
) => {
  const byId = new Map(candidates.map(candidate => [candidate.id, candidate]));
  const repairRounds = objectValue(autoStyleRepair)?.["rounds"];
  if (Array.isArray(repairRounds)) {
    for (const value of repairRounds) {
      const round = objectValue(value);
      const sequence = numberValue(round?.["round"]);
      const sourceCandidateId = stringValue(round?.["source_candidate_id"]);
      const generatedIds = round?.["generated_candidate_ids"];
      if (!Array.isArray(generatedIds)) continue;
      for (const generatedId of generatedIds) {
        const candidate = byId.get(stringValue(generatedId));
        if (!candidate) continue;
        candidate.origin = {
          kind: "auto_repair",
          sequence,
          source_candidate_id: sourceCandidateId || null,
        };
      }
    }
  }

  const regenerationEntries = objectValue(sourceRegenerations)?.["entries"];
  if (!Array.isArray(regenerationEntries)) return;
  for (const [index, value] of regenerationEntries.entries()) {
    const entry = objectValue(value);
    const sourceCandidateId = stringValue(entry?.["source_candidate_id"]);
    const generatedIds = entry?.["generated_candidate_ids"];
    if (!Array.isArray(generatedIds)) continue;
    for (const generatedId of generatedIds) {
      const candidate = byId.get(stringValue(generatedId));
      if (!candidate) continue;
      candidate.origin = {
        kind: "source_regeneration",
        sequence: index + 1,
        source_candidate_id: sourceCandidateId || null,
      };
    }
  }
};

const readJsonBody = async (
  request: IncomingMessage
): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) {
      throw new Error("Review request is too large.");
    }
    chunks.push(buffer);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Review request must be a JSON object.");
  }
  return value as Record<string, unknown>;
};

const requiredString = (value: Record<string, unknown>, key: string) => {
  const result = optionalString(value[key]);
  if (!result) {
    throw new Error(`Review request is missing ${key}.`);
  }
  return result;
};

const optionalString = (value: unknown) =>
  typeof value === "string" ? value : "";

const reviewStatus = (value: unknown): "approved" | "rejected" => {
  if (value !== "approved" && value !== "rejected") {
    throw new Error("Review status must be approved or rejected.");
  }
  return value;
};

const readJson = async (path: string): Promise<JsonValue> =>
  JSON.parse(await readFile(path, "utf8")) as JsonValue;

const readJsonIfExists = async (path: string) => {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
};

const readTextIfExists = async (path: string) => {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
};

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";

const numberValue = (value: unknown) =>
  typeof value === "number" ? value : null;

const objectValue = (value: unknown) =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : null;

const artifactUrl = (runDir: string, artifactPath: string) => {
  const normalizedPath = artifactPath.startsWith("file://")
    ? new URL(artifactPath).pathname
    : artifactPath;
  const relativePath = relative(runDir, normalizedPath);
  return `/artifact/${relativePath.split(sep).map(encodeURIComponent).join("/")}`;
};

const firstExistingArtifactUrl = (
  runDir: string,
  photoDir: string,
  filenames: string[]
) => {
  const first = filenames[0];
  return first ? artifactUrl(runDir, join(photoDir, first)) : null;
};

const isInside = (root: string, candidate: string) => {
  const relativePath = relative(root, candidate);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !relativePath.startsWith("/"))
  );
};

const contentTypeFor = (path: string) => {
  const extension = extname(path).toLowerCase();
  if (extension === ".png") {
    return "image/png";
  }
  if (extension === ".jpg" || extension === ".jpeg") {
    return "image/jpeg";
  }
  if (extension === ".json") {
    return "application/json; charset=utf-8";
  }
  if (extension === ".md" || extension === ".txt") {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
};

const renderHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Pictobook Pipeline QA</title>
    <style>
      :root {
        color-scheme: light;
        --canvas: #f4f4f0;
        --surface: #ffffff;
        --surface-soft: #f9f9f6;
        --ink: #18201f;
        --muted: #68716f;
        --faint: #919996;
        --line: #dde1dc;
        --line-strong: #c5ccc5;
        --coral: #d95d46;
        --coral-dark: #a43f2e;
        --coral-soft: #fff0eb;
        --navy: #16314a;
        --navy-soft: #eaf1f6;
        --ok: #236b4d;
        --ok-soft: #e7f4ed;
        --warn: #936019;
        --warn-soft: #fbf1dc;
        --danger: #a33f3f;
        --danger-soft: #faeaea;
        --shadow-1: 0 1px 2px rgba(24, 32, 31, .06), 0 4px 16px rgba(24, 32, 31, .04);
        --shadow-2: 0 2px 4px rgba(24, 32, 31, .08), 0 16px 40px rgba(24, 32, 31, .08);
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--canvas);
        color: var(--ink);
        font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 14px;
        line-height: 1.5;
      }
      button, textarea, input { font: inherit; }
      button:focus-visible, summary:focus-visible, textarea:focus-visible, input:focus-visible {
        outline: 3px solid rgba(217, 93, 70, .35);
        outline-offset: 3px;
      }
      header {
        position: sticky;
        top: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 32px;
        min-height: 72px;
        padding: 12px 24px;
        border-bottom: 1px solid var(--line);
        background: rgba(255, 255, 255, .92);
        backdrop-filter: blur(16px) saturate(140%);
      }
      .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .brand-mark {
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        flex: 0 0 auto;
        border-radius: 12px;
        background: var(--coral);
        color: white;
        font-family: Georgia, "Times New Roman", serif;
        font-size: 24px;
        font-weight: 700;
        box-shadow: inset 0 0 0 1px rgba(0, 0, 0, .08);
      }
      .brand h1 { margin: 0; font-size: 16px; line-height: 1.2; letter-spacing: -.01em; }
      .brand p { margin: 2px 0 0; color: var(--muted); font-size: 12px; }
      .run-meta {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 16px;
        min-width: 0;
        color: var(--muted);
        font-size: 12px;
      }
      .run-path {
        max-width: min(36vw, 520px);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        color: var(--faint);
      }
      .meta-cluster {
        display: flex;
        gap: 8px;
      }
      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        min-height: 28px;
        padding: 4px 10px;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: var(--surface-soft);
        color: var(--ink);
        font-weight: 650;
        white-space: nowrap;
      }
      .status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
      .pill.passed, .pill.approved { border-color: #b9d9c8; background: var(--ok-soft); color: var(--ok); }
      .pill.needs_review { border-color: #ead3a9; background: var(--warn-soft); color: var(--warn); }
      .pill.failed, .pill.rejected { border-color: #ebc2c2; background: var(--danger-soft); color: var(--danger); }
      .pill.superseded { color: var(--muted); }
      .shell {
        display: grid;
        grid-template-columns: 272px minmax(0, 1fr);
        min-height: calc(100vh - 72px);
      }
      aside {
        position: sticky;
        top: 72px;
        align-self: start;
        height: calc(100vh - 72px);
        padding: 24px 16px;
        overflow-y: auto;
        border-right: 1px solid var(--line);
        background: var(--surface);
      }
      .rail-label, .eyebrow {
        margin: 0 8px 12px;
        color: var(--faint);
        font-size: 11px;
        font-weight: 750;
        letter-spacing: .09em;
        text-transform: uppercase;
      }
      .photo-button {
        width: 100%;
        display: grid;
        grid-template-columns: 48px minmax(0, 1fr);
        gap: 12px;
        align-items: center;
        min-height: 68px;
        padding: 10px;
        margin-bottom: 6px;
        border: 1px solid transparent;
        border-radius: 12px;
        background: transparent;
        color: inherit;
        text-align: left;
        cursor: pointer;
        transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
      }
      .photo-button:hover { background: var(--surface-soft); border-color: var(--line); }
      .photo-button:active { transform: translateY(1px); }
      .photo-button.active {
        border-color: #e5b5a8;
        background: var(--coral-soft);
      }
      .photo-button img {
        width: 48px;
        height: 48px;
        object-fit: cover;
        border-radius: 9px;
        background: var(--surface);
        box-shadow: inset 0 0 0 1px var(--line);
      }
      .photo-label {
        overflow: hidden;
        font-weight: 700;
        font-size: 13px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .photo-sub {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 3px;
        color: var(--muted);
        font-size: 11px;
      }
      .mini-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
      .mini-status.passed, .mini-status.approved { color: var(--ok); }
      .mini-status.needs_review { color: var(--warn); }
      .mini-status.failed, .mini-status.rejected { color: var(--danger); }
      .qa-status.print_and_style_passed { color: var(--ok); }
      .qa-status.print_only { color: var(--warn); }
      .qa-status.none_passed { color: var(--danger); }
      .qa-legend {
        display: grid;
        gap: 8px;
        margin: 0 8px 18px;
        padding: 12px;
        border-radius: 12px;
        background: var(--surface-soft);
        color: var(--muted);
        font-size: 11px;
      }
      .qa-legend-row {
        display: grid;
        grid-template-columns: 9px minmax(0, 1fr) auto;
        gap: 8px;
        align-items: center;
      }
      .qa-legend-row strong { color: var(--ink); font-variant-numeric: tabular-nums; }
      .qa-legend-dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
      .workspace {
        min-width: 0;
        padding: 40px clamp(24px, 4vw, 64px) 72px;
      }
      .workspace-inner { width: min(100%, 1440px); margin: 0 auto; }
      .review-heading {
        display: flex;
        align-items: flex-end;
        justify-content: space-between;
        gap: 24px;
        margin-bottom: 32px;
      }
      .review-heading .eyebrow { margin: 0 0 7px; }
      .review-heading h2 {
        margin: 0;
        max-width: 760px;
        font-family: Georgia, "Times New Roman", serif;
        font-size: clamp(27px, 3vw, 40px);
        font-weight: 600;
        line-height: 1.08;
        letter-spacing: -.025em;
      }
      .review-heading p { max-width: 680px; margin: 10px 0 0; color: var(--muted); }
      .review-grid {
        display: grid;
        grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
        gap: 32px;
        align-items: start;
      }
      .context-column {
        position: sticky;
        top: 104px;
        display: grid;
        gap: 16px;
      }
      .section-heading {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 14px;
      }
      .section-heading h3 { margin: 0; font-size: 15px; letter-spacing: -.01em; }
      .section-heading span { color: var(--muted); font-size: 12px; }
      .panel {
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--surface);
        box-shadow: var(--shadow-1);
      }
      .source-image {
        display: block;
        width: 100%;
        max-height: 390px;
        object-fit: contain;
        background: #eceeeb;
      }
      .panel-copy { padding: 16px; }
      .panel-kicker { margin: 0 0 6px; color: var(--faint); font-size: 11px; font-weight: 750; letter-spacing: .07em; text-transform: uppercase; }
      .brief { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.55; }
      details { border-top: 1px solid var(--line); }
      summary {
        padding: 13px 16px;
        color: var(--muted);
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }
      pre {
        margin: 0;
        max-height: 360px;
        overflow: auto;
        padding: 16px;
        border-top: 1px solid var(--line);
        background: #202826;
        color: #eaf0ed;
        font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
      .candidate-column { min-width: 0; }
      .candidates {
        display: grid;
        grid-template-columns: repeat(2, minmax(260px, 1fr));
        gap: 20px;
      }
      .candidate {
        position: relative;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 16px;
        background: var(--surface);
        box-shadow: var(--shadow-1);
        transition: border-color 140ms ease, box-shadow 140ms ease, transform 140ms ease;
      }
      .candidate:hover { border-color: var(--line-strong); box-shadow: var(--shadow-2); transform: translateY(-2px); }
      .candidate.selected { border-color: #8fbca5; box-shadow: 0 0 0 3px var(--ok-soft), var(--shadow-2); }
      .candidate-image-wrap { position: relative; padding: 16px; background: #eceeeb; }
      .candidate img {
        display: block;
        width: 100%;
        aspect-ratio: 2480 / 3508;
        object-fit: contain;
        border-radius: 6px;
        background: white;
        box-shadow: 0 1px 2px rgba(24, 32, 31, .08), 0 8px 24px rgba(24, 32, 31, .08);
      }
      .selected-flag {
        position: absolute;
        top: 28px;
        left: 28px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 6px 9px;
        border-radius: 999px;
        background: var(--ok);
        color: white;
        font-size: 11px;
        font-weight: 750;
        box-shadow: var(--shadow-1);
      }
      .origin-flag {
        position: absolute;
        top: 28px;
        right: 28px;
        max-width: calc(100% - 56px);
        padding: 6px 9px;
        overflow: hidden;
        border: 1px solid rgba(24, 32, 31, .12);
        border-radius: 999px;
        background: rgba(255, 255, 255, .94);
        color: var(--muted);
        font-size: 10px;
        font-weight: 750;
        text-overflow: ellipsis;
        white-space: nowrap;
        box-shadow: var(--shadow-1);
      }
      .origin-flag.auto_repair { border-color: #b9cddd; background: var(--navy-soft); color: var(--navy); }
      .origin-flag.source_regeneration { border-color: #e5b5a8; background: var(--coral-soft); color: var(--coral-dark); }
      .candidate-body { padding: 16px; }
      .candidate-title { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .candidate-title strong { font-size: 14px; }
      .score-value { font-variant-numeric: tabular-nums; font-size: 13px; font-weight: 750; }
      .metric-grid {
        display: grid;
        grid-template-columns: repeat(4, 1fr);
        gap: 1px;
        margin-top: 14px;
        overflow: hidden;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--line);
      }
      .metric { padding: 10px; background: var(--surface-soft); }
      .metric span { display: block; color: var(--faint); font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
      .metric strong { display: block; margin-top: 2px; font-size: 13px; font-variant-numeric: tabular-nums; }
      .reason-list { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
      .reason {
        padding: 4px 7px;
        border-radius: 6px;
        background: var(--warn-soft);
        color: var(--warn);
        font-size: 10px;
        font-weight: 700;
      }
      .style-summary {
        display: grid;
        gap: 9px;
        margin-top: 14px;
        padding: 12px;
        border-radius: 10px;
        background: var(--navy-soft);
        color: var(--navy);
      }
      .style-summary-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
      .style-summary-head strong { font-size: 11px; letter-spacing: .05em; text-transform: uppercase; }
      .style-summary p { margin: 0; font-size: 12px; line-height: 1.45; }
      .drift-list { display: flex; flex-wrap: wrap; gap: 5px; }
      .drift-item { padding: 4px 7px; border-radius: 6px; background: rgba(255, 255, 255, .68); font-size: 10px; }
      .review-form {
        display: grid;
        gap: 12px;
        padding: 16px;
        border-top: 1px solid var(--line);
        background: var(--surface-soft);
      }
      .review-form label:not(.check-label) {
        display: grid;
        gap: 6px;
        color: var(--muted);
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .04em;
        text-transform: uppercase;
      }
      .review-form textarea {
        width: 100%;
        min-height: 72px;
        resize: vertical;
        padding: 10px 12px;
        border: 1px solid var(--line-strong);
        border-radius: 9px;
        background: var(--surface);
        color: var(--ink);
        font-size: 12px;
        line-height: 1.45;
        text-transform: none;
        letter-spacing: 0;
      }
      .review-form textarea::placeholder { color: var(--faint); }
      .review-options { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
      .check-label {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        color: var(--muted);
        font-size: 12px;
        cursor: pointer;
      }
      .check-label input { width: 16px; height: 16px; accent-color: var(--coral); }
      .review-actions { display: flex; flex-wrap: wrap; gap: 8px; }
      .action-button {
        min-height: 36px;
        padding: 7px 12px;
        border: 1px solid var(--line-strong);
        border-radius: 9px;
        background: var(--surface);
        color: var(--ink);
        font-size: 12px;
        font-weight: 750;
        cursor: pointer;
      }
      .action-button:hover { border-color: var(--ink); }
      .action-button.primary { border-color: var(--coral); background: var(--coral); color: white; }
      .action-button.primary:hover { border-color: var(--coral-dark); background: var(--coral-dark); }
      .action-button.danger { color: var(--danger); }
      .action-button:disabled { cursor: wait; opacity: .55; }
      .review-stamp { color: var(--muted); font-size: 11px; }
      .review-stamp strong { color: var(--ink); }
      .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 30;
        max-width: min(380px, calc(100vw - 40px));
        padding: 12px 14px;
        border: 1px solid #b9d9c8;
        border-radius: 10px;
        background: var(--ok-soft);
        color: var(--ok);
        box-shadow: var(--shadow-2);
        font-size: 12px;
        font-weight: 700;
      }
      .toast.error { border-color: #ebc2c2; background: var(--danger-soft); color: var(--danger); }
      .empty-state {
        padding: 64px 24px;
        border: 1px dashed var(--line-strong);
        border-radius: 16px;
        color: var(--muted);
        text-align: center;
        background: rgba(255, 255, 255, .45);
      }
      .loading {
        display: grid;
        min-height: calc(100vh - 72px);
        place-items: center;
        color: var(--muted);
      }
      .loading::before {
        content: "";
        width: 18px;
        height: 18px;
        margin-right: 10px;
        border: 2px solid var(--line-strong);
        border-top-color: var(--coral);
        border-radius: 50%;
        animation: spin .8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
      @media (max-width: 1100px) {
        .candidates { grid-template-columns: 1fr; }
      }
      @media (max-width: 820px) {
        header { position: static; padding: 12px 16px; }
        .run-path { display: none; }
        .shell { grid-template-columns: 1fr; }
        aside {
          position: static;
          height: auto;
          padding: 12px 16px;
          overflow-x: auto;
          border-right: 0;
          border-bottom: 1px solid var(--line);
        }
        .rail-label { display: none; }
        #photoList { display: flex; gap: 8px; }
        .photo-button { width: 210px; flex: 0 0 auto; margin: 0; }
        .workspace { padding: 28px 16px 56px; }
        .review-heading, .review-grid { display: grid; grid-template-columns: 1fr; }
        .review-heading { gap: 16px; }
        .context-column { display: contents; }
        .source-context { order: 1; }
        .candidate-column { order: 2; }
        .brief-context { order: 3; }
      }
      @media (max-width: 520px) {
        .brand p, .meta-cluster .provider-pill { display: none; }
        .review-heading h2 { font-size: 28px; }
        .candidates { gap: 16px; }
        .candidate-image-wrap { padding: 10px; }
        .selected-flag { top: 20px; left: 20px; }
      }
    </style>
  </head>
  <body>
    <header>
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">P</div>
        <div>
          <h1>Pictobook QA</h1>
          <p>Coloring page review workspace</p>
        </div>
      </div>
      <div class="run-meta" id="runMeta"></div>
    </header>
    <div id="app" class="loading">Loading run artifacts…</div>
    <div id="toast" role="status" aria-live="polite"></div>
    <script>
      let data;
      let selected = 0;
      let savingCandidate = null;
      let regeneratingCandidate = null;
      const fmt = value => value == null ? "—" : Number(value).toFixed(2);
      document.addEventListener("click", event => {
        const regenerationButton = event.target.closest("[data-regenerate-source]");
        if (regenerationButton) {
          regenerateFromSource(
            regenerationButton.dataset.photoId,
            regenerationButton.dataset.candidateId
          );
          return;
        }
        const button = event.target.closest("[data-review-status]");
        if (!button) return;
        saveReview(
          button.dataset.photoId,
          button.dataset.candidateId,
          button.dataset.reviewStatus
        );
      });
      loadData();

      function loadData() {
        return fetch("/api/run")
          .then(response => {
            if (!response.ok) throw new Error("Could not load run data");
            return response.json();
          })
          .then(json => {
            data = json;
            render();
          })
          .catch(error => {
          document.getElementById("app").className = "empty-state";
          document.getElementById("app").textContent = error.message;
          });
      }

      function render() {
        const runStatus = statusClass(data.run.status);
        document.getElementById("runMeta").innerHTML =
          '<span class="run-path" title="' + escapeAttr(data.run_dir) + '">' + escapeHtml(data.run_dir) + '</span>' +
          '<div class="meta-cluster">' +
            '<span class="pill">' + escapeHtml(data.run_label) + '</span>' +
            '<span class="pill provider-pill">' + escapeHtml(data.run.provider || "unknown") + '</span>' +
            '<span class="pill ' + runStatus + '"><span class="status-dot"></span>' + escapeHtml(humanize(data.run.status)) + '</span>' +
          '</div>';

        if (!data.photos.length) {
          document.getElementById("app").className = "empty-state";
          document.getElementById("app").textContent = "This run does not contain any photos yet.";
          return;
        }

        const photo = data.photos[selected];
        const candidateCount = photo.candidates.length;
        const reviewCount = photo.candidates.filter(candidate => candidate.status !== "passed").length;
        const rankSummary = photo.approved_style_rank
          ? ' · human pick ranks ' + photo.approved_style_rank + ' of ' + photo.style_qa_count
          : '';
        const generationSummary = candidateOriginSummary(photo.candidates);
        const qaCounts = data.photos.reduce((counts, item) => {
          counts[item.qa_status] = (counts[item.qa_status] || 0) + 1;
          return counts;
        }, {});
        document.getElementById("app").className = "shell";
        document.getElementById("app").innerHTML =
          '<aside aria-label="Photos in this run">' +
            '<p class="rail-label">Photos · ' + data.photos.length + '</p>' +
            qaLegend(qaCounts) +
            '<div id="photoList">' + data.photos.map(photoButton).join("") + '</div>' +
          '</aside>' +
          '<main class="workspace"><div class="workspace-inner">' +
            '<div class="review-heading">' +
              '<div><p class="eyebrow">Reviewing ' + escapeHtml(photo.display_id) + '</p>' +
              '<h2>' + escapeHtml(photo.page_brief?.metadata_caption || "Generated coloring page") + '</h2>' +
              '<p>Compare each output with the source, then use the automated checks as supporting evidence—not as a substitute for visual judgment.</p></div>' +
              '<span class="pill ' + statusClass(photo.status) + '"><span class="status-dot"></span>' + escapeHtml(humanize(photo.status)) + '</span>' +
            '</div>' +
            '<div class="review-grid">' +
              '<div class="context-column">' + sourcePanel(photo) + briefPanel(photo) + '</div>' +
              '<section class="candidate-column" aria-labelledby="candidateHeading">' +
                '<div class="section-heading"><h3 id="candidateHeading">Generated candidates</h3><span>' + candidateCount + ' total · ' + generationSummary + ' · ' + reviewCount + ' print flagged' + rankSummary + '</span></div>' +
                (candidateCount ? '<div class="candidates">' + photo.candidates.map(candidate => candidateCard(candidate, photo)).join("") + '</div>' : '<div class="empty-state">No generated candidates were found for this photo.</div>') +
              '</section>' +
            '</div>' +
          '</div></main>';
      }

      function photoButton(photo, index) {
        const active = index === selected;
        return '<button type="button" class="photo-button' + (active ? " active" : "") + '" aria-pressed="' + active + '" onclick="selected=' + index + '; render()">' +
          '<img src="' + escapeAttr(photo.normalized_url) + '" alt="" />' +
          '<div><div class="photo-label" title="' + escapeAttr(photo.display_id) + '">' + escapeHtml(photo.display_id) + '</div>' +
          '<div class="photo-sub qa-status ' + escapeAttr(photo.qa_status) + '"><span class="mini-dot"></span>' + escapeHtml(qaStatusLabel(photo.qa_status)) + '</div></div>' +
        '</button>';
      }

      function qaLegend(counts) {
        return '<div class="qa-legend" aria-label="QA status legend">' +
          legendRow("print_and_style_passed", "Print + Style passed", counts.print_and_style_passed || 0) +
          legendRow("print_only", "Print only", counts.print_only || 0) +
          legendRow("none_passed", "Neither passed", counts.none_passed || 0) +
        '</div>';
      }

      function legendRow(status, label, count) {
        return '<div class="qa-legend-row qa-status ' + escapeAttr(status) + '"><span class="qa-legend-dot" aria-hidden="true"></span><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(count) + '</strong></div>';
      }

      function qaStatusLabel(status) {
        if (status === "print_and_style_passed") return "Print + Style passed";
        if (status === "print_only") return "Print passed · Style not passed";
        return "Neither QA passed";
      }

      function sourcePanel(photo) {
        return '<section class="source-context"><div class="section-heading"><h3>Source photo</h3><span>Normalized input</span></div>' +
          '<div class="panel"><img class="source-image" src="' + escapeAttr(photo.normalized_url) + '" alt="Source photo for ' + escapeAttr(photo.id) + '" />' +
          '<details><summary>View photo analysis</summary><pre>' + escapeHtml(JSON.stringify(photo.photo_analysis, null, 2)) + '</pre></details></div></section>';
      }

      function briefPanel(photo) {
        return '<section class="panel brief-context"><div class="panel-copy"><p class="panel-kicker">Generation brief</p>' +
          '<p class="brief">' + escapeHtml(photo.page_brief?.final_brief || "No page brief was recorded.") + '</p></div></section>';
      }

      function candidateCard(candidate, photo) {
        const selectedCandidate = photo.approved_candidate_id
          ? photo.approved_candidate_id === candidate.id
          : photo.selected_url && candidate.image_url === photo.selected_url;
        const fitness = candidate.qa?.print_fitness || {};
        const reasons = candidate.qa?.blocking_reasons || [];
        const styleQa = candidate.style_qa;
        return '<article class="candidate' + (selectedCandidate ? " selected" : "") + '" id="card-' + escapeAttr(candidate.id) + '">' +
          '<div class="candidate-image-wrap">' +
            '<img src="' + escapeAttr(candidate.image_url) + '" alt="' + escapeAttr(humanize(candidate.id)) + ' coloring page" loading="lazy" />' +
            (selectedCandidate ? '<span class="selected-flag"><span aria-hidden="true">✓</span> Selected</span>' : "") +
            originFlag(candidate.origin) +
          '</div>' +
          '<div class="candidate-body">' +
            '<div class="candidate-title"><strong>' + escapeHtml(humanize(candidate.id)) + '</strong>' +
            '<span class="pill ' + statusClass(candidate.status) + '"><span class="status-dot"></span>Print QA · ' + escapeHtml(humanize(candidate.status)) + '</span></div>' +
            '<div class="metric-grid">' +
              metric("Print QA score", fmt(candidate.score)) +
              metric("Style QA score", styleQa ? fmt(styleQa.overall_score) : "Not run") +
              metric("Black ink", percent(fitness.black_pixel_ratio)) +
              metric("Gray pixels", percent(fitness.gray_pixel_ratio)) +
            '</div>' +
            (reasons.length ? '<div class="reason-list" aria-label="Blocking reasons">' + reasons.map(reason => '<span class="reason">' + escapeHtml(humanize(reason)) + '</span>').join("") + '</div>' : "") +
            styleSummary(styleQa, candidate.effective_style_status, candidate.style_rank, photo.style_qa_count) +
          '</div>' +
          reviewForm(candidate, photo) +
          (styleQa ? '<details><summary>Inspect style evidence</summary><pre>' + escapeHtml(JSON.stringify(styleQa, null, 2)) + '</pre></details>' : "") +
          '<details><summary>Inspect Print QA details</summary><pre>' + escapeHtml(JSON.stringify(candidate.qa, null, 2)) + '</pre></details>' +
        '</article>';
      }

      function originFlag(origin) {
        const label = originLabel(origin);
        const source = origin.source_candidate_id ? " · from " + humanize(origin.source_candidate_id) : "";
        return '<span class="origin-flag ' + escapeAttr(origin.kind) + '" title="' + escapeAttr(label + source) + '">' + escapeHtml(label) + '</span>';
      }

      function originLabel(origin) {
        if (origin.kind === "source_regeneration") return "Source regen · Run " + origin.sequence;
        if (origin.kind === "auto_repair") return "Auto repair · Round " + origin.sequence;
        return "Original generation";
      }

      function candidateOriginSummary(candidates) {
        const counts = candidates.reduce((result, candidate) => {
          result[candidate.origin.kind] = (result[candidate.origin.kind] || 0) + 1;
          return result;
        }, {});
        return [
          (counts.original || 0) + " original",
          (counts.auto_repair || 0) + " auto repair",
          (counts.source_regeneration || 0) + " source regen"
        ].join(" · ");
      }

      function styleSummary(styleQa, effectiveStatus, rank, total) {
        if (!styleQa) {
          return '<div class="style-summary"><div class="style-summary-head"><strong>Style QA · Visual judge</strong><span class="pill">Style QA · Not run</span></div><p>Run the style-QA backfill to compare this page with canonical references.</p></div>';
        }
        const drift = Array.isArray(styleQa.drift) ? styleQa.drift : [];
        return '<div class="style-summary"><div class="style-summary-head"><strong>Style QA · Visual judge · rank ' + escapeHtml(rank || "—") + ' of ' + escapeHtml(total || "—") + '</strong>' +
          '<span class="pill ' + statusClass(effectiveStatus) + '"><span class="status-dot"></span>Style QA · ' + escapeHtml(humanize(effectiveStatus)) + '</span></div>' +
          '<p>' + escapeHtml(styleQa.recommendation || "No recommendation returned.") + '</p>' +
          (drift.length ? '<div class="drift-list">' + drift.map(item => '<span class="drift-item">' + escapeHtml(item) + '</span>').join("") + '</div>' : "") +
          '</div>';
      }

      function reviewForm(candidate, photo) {
        const review = candidate.review || {};
        const busy = savingCandidate === candidate.id || regeneratingCandidate === candidate.id;
        const timestamp = review.reviewed_at
          ? '<span class="review-stamp">Saved <strong>' + escapeHtml(new Date(review.reviewed_at).toLocaleString()) + '</strong></span>'
          : '<span class="review-stamp">No human decision yet</span>';
        return '<div class="review-form">' +
          '<label for="notes-' + escapeAttr(candidate.id) + '">Reviewer notes' +
            '<textarea id="notes-' + escapeAttr(candidate.id) + '" placeholder="What makes this page work—or what should change?">' + escapeHtml(review.reviewer_notes || "") + '</textarea>' +
          '</label>' +
          '<div class="review-options">' +
            '<label class="check-label"><input id="canonical-' + escapeAttr(candidate.id) + '" type="checkbox"' + (review.canonical ? " checked" : "") + '> Add to canonical references</label>' +
            timestamp +
          '</div>' +
          '<div class="review-actions">' +
            '<button class="action-button primary" type="button" data-photo-id="' + escapeAttr(photo.id) + '" data-candidate-id="' + escapeAttr(candidate.id) + '" data-review-status="approved"' + (busy ? " disabled" : "") + '>Approve page</button>' +
            '<button class="action-button danger" type="button" data-photo-id="' + escapeAttr(photo.id) + '" data-candidate-id="' + escapeAttr(candidate.id) + '" data-review-status="rejected"' + (busy ? " disabled" : "") + '>Reject</button>' +
            '<button class="action-button" type="button" data-regenerate-source data-photo-id="' + escapeAttr(photo.id) + '" data-candidate-id="' + escapeAttr(candidate.id) + '"' + (busy ? " disabled" : "") + '>' + (regeneratingCandidate === candidate.id ? "Regenerating…" : "Regenerate from source") + '</button>' +
          '</div>' +
        '</div>';
      }

      async function regenerateFromSource(photoId, candidateId) {
        if (!window.confirm("Generate 3 fresh candidates from the original source using this candidate’s judge findings and your notes?")) return;
        const notes = document.getElementById("notes-" + candidateId)?.value || "";
        regeneratingCandidate = candidateId;
        render();
        showToast("Regeneration started. This can take several minutes.");
        try {
          const response = await fetch("/api/regenerations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              photo_id: photoId,
              candidate_id: candidateId,
              notes
            })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || "Could not regenerate from source");
          await loadData();
          showToast("Three fresh candidates generated and evaluated.");
          const bestId = result.regeneration?.best_generated_candidate_id;
          if (bestId) document.getElementById("card-" + bestId)?.scrollIntoView({ block: "center" });
        } catch (error) {
          showToast(error instanceof Error ? error.message : String(error), true);
        } finally {
          regeneratingCandidate = null;
          render();
        }
      }

      async function saveReview(photoId, candidateId, status) {
        const notes = document.getElementById("notes-" + candidateId)?.value || "";
        const canonical = status === "approved" && Boolean(document.getElementById("canonical-" + candidateId)?.checked);
        savingCandidate = candidateId;
        render();
        try {
          const response = await fetch("/api/reviews", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              photo_id: photoId,
              candidate_id: candidateId,
              status,
              canonical,
              notes
            })
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(result.message || "Could not save review");
          showToast(status === "approved" ? "Page approved and catalogue updated." : "Candidate rejected.");
          await loadData();
          document.getElementById("card-" + candidateId)?.scrollIntoView({ block: "center" });
        } catch (error) {
          showToast(error instanceof Error ? error.message : String(error), true);
        } finally {
          savingCandidate = null;
          render();
        }
      }

      function showToast(message, isError = false) {
        const toast = document.getElementById("toast");
        toast.className = "toast" + (isError ? " error" : "");
        toast.textContent = message;
        window.setTimeout(() => {
          toast.className = "";
          toast.textContent = "";
        }, 3500);
      }

      function metric(label, value) {
        return '<div class="metric"><span>' + label + '</span><strong>' + value + '</strong></div>';
      }

      function percent(value) {
        return value == null ? "—" : (Number(value) * 100).toFixed(1) + "%";
      }

      function humanize(value) {
        return String(value || "unknown")
          .replaceAll("_", " ")
          .split(" ")
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(" ");
      }

      function statusClass(value) {
        return String(value || "").toLowerCase().replaceAll(" ", "_");
      }

      function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, char => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        }[char]));
      }

      function escapeAttr(value) {
        return escapeHtml(value == null ? "" : value);
      }

    </script>
  </body>
</html>`;

await main();
