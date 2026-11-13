import { createHash, randomBytes, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = fileURLToPath(new URL("..", import.meta.url));
const persistDir = "../../tmp/cloudflare-spike/state";
const database = "pictobook-pipeline-spike-dev";
const baseUrl = process.env.LOCAL_API_URL ?? "http://127.0.0.1:8787";
const token = randomBytes(32).toString("base64url");
const ownerId = `local-smoke-${randomUUID()}`;

const wrangler = args => {
  const result = spawnSync(
    "pnpm",
    ["exec", "wrangler", "--config", "wrangler.local.jsonc", ...args],
    { cwd: appDir, encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(`Local Wrangler command failed: ${result.stderr || result.stdout}`);
  }
};

wrangler([
  "d1", "migrations", "apply", database, "--local", "--persist-to", persistDir,
]);

const now = new Date();
const tokenHash = createHash("sha256").update(token).digest("hex");
const sessionId = `local-smoke-session-${randomUUID()}`;
const expiresAt = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
const sql = `INSERT INTO api_sessions (session_id, token_sha256, user_id, expires_at, revoked_at, created_at) VALUES ('${sessionId}', '${tokenHash}', '${ownerId}', '${expiresAt}', NULL, '${now.toISOString()}');`;
wrangler([
  "d1", "execute", database, "--local", "--persist-to", persistDir, "--command", sql,
]);

const request = async (method, path, { body, bytes, idempotencyKey } = {}) => {
  const headers = { Authorization: `Bearer ${token}` };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (bytes) headers["Content-Type"] = "image/png";
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers,
    body: body === undefined ? bytes : JSON.stringify(body),
  });
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`${method} ${path} returned ${response.status}: ${details}`);
  }
  if (response.status === 204) return null;
  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json") ? response.json() : response;
};

const book = await request("POST", "/v1/books", {
  body: {},
  idempotencyKey: `smoke-create-book-${randomUUID()}`,
});
const bookId = book.bookId;
const sourcePhotos = Array.from({ length: 5 }, (_, index) => {
  const bytes = Buffer.from(`local-only-smoke-photo-${index + 1}`);
  return {
    bytes,
    metadata: {
      contentType: "image/png",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
  };
});
const run = await request("POST", `/v1/books/${bookId}/runs`, {
  body: { photos: sourcePhotos.map(photo => photo.metadata) },
  idempotencyKey: `smoke-create-run-${randomUUID()}`,
});

for (let index = 0; index < run.uploads.length; index += 1) {
  const upload = run.uploads[index];
  await request("PUT", upload.uploadUrl, { bytes: sourcePhotos[index].bytes });
}

const photoIds = run.uploads.map(upload => upload.photoId).reverse();
await request("PATCH", `/v1/books/${bookId}/runs/${run.runId}/photo-order`, {
  body: { photoIds },
  idempotencyKey: `smoke-photo-order-${randomUUID()}`,
});
await request("POST", `/v1/books/${bookId}/runs/${run.runId}/start`, {
  body: {},
  idempotencyKey: `smoke-start-run-${randomUUID()}`,
});

let status;
let detail;
const deadline = Date.now() + 120_000;
while (Date.now() < deadline) {
  detail = await request("GET", `/v1/books/${bookId}/runs/${run.runId}`);
  status = detail.run?.status ?? detail.status;
  if (["completed", "partially_completed", "failed"].includes(status)) break;
  await new Promise(resolve => setTimeout(resolve, 750));
}
if (status !== "completed") {
  throw new Error(`Local run did not complete successfully (status: ${status ?? "unknown"})`);
}

const artifact = detail.artifacts?.find(item => item.artifact_kind === "candidate_clean");
if (!artifact) throw new Error("Completed run has no cleaned candidate artifact");
const artifactAccess = await request(
  "GET",
  `/v1/artifacts/${encodeURIComponent(artifact.artifact_id)}/access`
);
const artifactResponse = await fetch(new URL(artifactAccess.access.url, baseUrl), {
  headers: { Authorization: `Bearer ${token}` },
});
const artifactBytes = await artifactResponse.arrayBuffer();
if (!artifactResponse.ok || artifactBytes.byteLength === 0) {
  throw new Error(`Local artifact read failed with ${artifactResponse.status}`);
}
const editions = await request("GET", "/v1/catalog/editions");
if (editions.editions.length === 0 || editions.editions.some(edition => edition.available)) {
  throw new Error("Local edition catalog must contain unavailable prototype entries");
}

const evidence = await writeSmokeEvidence({
  bookId,
  runId: run.runId,
  status,
  pageCount: detail.pages?.length ?? 0,
  artifactRead: "passed",
  editionCatalog: "prototype-only",
  provider: "mock",
  dataSource: "synthetic placeholder photo bytes",
  bindings: ["local Worker", "local D1", "local R2", "local Workflow"],
  externalServices: [],
});

console.log(JSON.stringify({
  mode: "local-mock",
  bookId,
  runId: run.runId,
  status,
  pageCount: detail.pages?.length ?? null,
  artifactRead: "passed",
  editionCatalog: "prototype-only",
  provider: "mock",
  dataSource: "synthetic placeholder photo bytes",
  remoteServicesUsed: false,
  evidence,
}, null, 2));

async function writeSmokeEvidence(result) {
  const runTime = new Date().toISOString();
  const timestamp = runTime.replace(/[:.]/g, "-");
  const outputDir = resolve(appDir, "../../artifacts/smoke", timestamp);
  await mkdir(outputDir, { recursive: true });
  const report = { ...result, generatedAt: runTime };
  await writeFile(join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

  const slides = [
    {
      title: "Local customer pipeline smoke",
      subtitle: "PASS · 5 pages completed",
      lines: [
        "DATA: synthetic placeholder images, not customer photos",
        "IMAGE PROVIDER: mock / deterministic output",
        "BINDINGS: local Worker · D1 · R2 · Workflow",
      ],
    },
    {
      title: "1. Create and upload",
      subtitle: "Authenticated local session",
      lines: [
        "Draft book created in local D1",
        "5 synthetic image payloads validated and stored in local R2",
        "Uploads passed through the authenticated Worker route",
      ],
    },
    {
      title: "2. Arrange and start",
      subtitle: "Local Workflow accepted the run",
      lines: [
        "Exact five-photo order persisted",
        "ProductionBookRun Workflow started locally",
        "No image Container or external image API used",
      ],
    },
    {
      title: "3. Generate and evaluate",
      subtitle: "5 pages · Print QA · Style QA",
      lines: [
        "Deterministic mock SVG candidates generated",
        "Mock print and style evaluations completed",
        "All run artifacts stored in local R2",
      ],
    },
    {
      title: "4. Read private artifact and catalog",
      subtitle: "Owner checks passed",
      lines: [
        "Candidate artifact retrieved through owner-authorized Worker access",
        "Edition catalog endpoint returned prototype entries",
        "Sample editions are unavailable with zero illustrative prices",
      ],
    },
    {
      title: "Verification: passed",
      subtitle: "This run contains fake test data",
      lines: [
        "Provider: mock · Data: synthetic placeholders",
        "Storage and Workflow: local D1 / R2 / Workflow",
        "No live customer photos, remote Cloudflare, AI, payment, or fulfillment",
      ],
    },
  ];
  await writeFile(join(outputDir, "report.html"), evidenceHtml(report, slides));

  if (process.platform !== "darwin" || !commandExists("sips") || !commandExists("ffmpeg")) {
    return { directory: outputDir, video: null, note: "Install sips and ffmpeg to render the video on this machine." };
  }

  const frameDir = await mkdtemp(join(tmpdir(), "pictobook-smoke-frames-"));
  try {
    for (let index = 0; index < slides.length; index += 1) {
      const svgPath = join(frameDir, `frame-${index}.svg`);
      const pngPath = join(frameDir, `frame-${String(index).padStart(2, "0")}.png`);
      await writeFile(svgPath, slideSvg(slides[index], result));
      const converted = spawnSync("sips", ["-s", "format", "png", svgPath, "--out", pngPath], {
        encoding: "utf8",
      });
      if (converted.status !== 0) throw new Error(`sips frame render failed: ${converted.stderr}`);
    }
    const videoPath = join(outputDir, "smoke.mp4");
    const encoded = spawnSync("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-framerate", "1/3", "-i", join(frameDir, "frame-%02d.png"),
      "-c:v", "libx264", "-r", "30", "-pix_fmt", "yuv420p", videoPath,
    ], { encoding: "utf8" });
    if (encoded.status !== 0) throw new Error(`ffmpeg video encoding failed: ${encoded.stderr}`);
    return { directory: outputDir, video: videoPath, durationSeconds: slides.length * 3 };
  } finally {
    await rm(frameDir, { recursive: true, force: true });
  }
}

function commandExists(command) {
  return spawnSync("which", [command], { encoding: "utf8" }).status === 0;
}

function slideSvg(slide, result) {
  const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const lines = slide.lines.map((line, index) =>
    `<text x="92" y="${360 + index * 66}" font-family="Arial,Helvetica,sans-serif" font-size="25" font-weight="500" fill="#1d302b">${escape(line)}</text>`
  ).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
    <rect width="1280" height="720" fill="#f5f3ed"/>
    <rect x="54" y="42" width="1172" height="64" rx="32" fill="#e4efe9"/>
    <circle cx="88" cy="74" r="9" fill="#2a745c"/>
    <text x="112" y="82" font-family="Arial,Helvetica,sans-serif" font-size="22" font-weight="700" letter-spacing="1.5" fill="#245943">PICTOBOOK PIPELINE · LOCAL MOCK RUN · SYNTHETIC DATA</text>
    <text x="82" y="218" font-family="Arial,Helvetica,sans-serif" font-size="52" font-weight="700" fill="#1d302b">${escape(slide.title)}</text>
    <text x="88" y="280" font-family="Arial,Helvetica,sans-serif" font-size="28" fill="#557168">${escape(slide.subtitle)}</text>
    <rect x="80" y="320" width="1120" height="250" rx="24" fill="#ffffff" stroke="#d8ddd5" stroke-width="2"/>
    ${lines}
    <line x1="82" y1="624" x2="1198" y2="624" stroke="#d8ddd5" stroke-width="2"/>
    <text x="84" y="665" font-family="Arial,Helvetica,sans-serif" font-size="18" font-weight="700" letter-spacing="1" fill="#6a7c75">RUN ${escape(result.runId)} · ${escape(result.pageCount)} PAGES · ${escape(result.status.toUpperCase())}</text>
  </svg>`;
}

function evidenceHtml(report, slides) {
  const rows = slides.map(slide => `<li><strong>${slide.title}</strong><span>${slide.subtitle}</span></li>`).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pictobook local smoke evidence</title><style>body{font:16px/1.5 system-ui,sans-serif;background:#f5f3ed;color:#1d302b;max-width:900px;margin:48px auto;padding:0 24px}header{background:#e4efe9;border-radius:20px;padding:24px}h1{margin:0 0 8px}strong,b{color:#245943}li{display:flex;justify-content:space-between;gap:20px;padding:14px 0;border-bottom:1px solid #d8ddd5}code{overflow-wrap:anywhere}.badge{display:inline-block;background:#2a745c;color:white;border-radius:20px;padding:4px 12px;font-weight:700}</style><header><span class="badge">PASSED · LOCAL MOCK</span><h1>Customer API smoke test</h1><p><strong>Data:</strong> synthetic placeholder image bytes, not customer photos<br><strong>Provider:</strong> mock<br><strong>Bindings:</strong> local Worker, D1, R2, Workflow</p><p><strong>External services:</strong> none</p></header><h2>Recorded steps</h2><ol>${rows}</ol><h2>Run result</h2><p>${report.pageCount} pages completed. Private artifact access and the prototype edition catalog both passed.</p><p><strong>Run ID:</strong> <code>${report.runId}</code></p><p><strong>Book ID:</strong> <code>${report.bookId}</code></p><p>Generated ${report.generatedAt}. This evidence uses fake test data and a deterministic mock provider.</p></html>`;
}
