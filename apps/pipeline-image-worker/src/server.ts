import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import sharp from "sharp";
import { runCleanupOperation } from "./cleanupOperation.js";
import {
  OperationConflictError,
  OperationInputError,
  runNormalizeOperation,
  type NormalizeOperationRequest,
} from "./normalizeOperation.js";
import { runPrintQaOperation } from "./printQaOperation.js";
import { S3ObjectStorage } from "./s3Storage.js";

const port = Number(process.env.PORT ?? "8790");
const maxRequestBytes = 64 * 1024;
sharp.cache(false);
sharp.concurrency(1);
const storage = new S3ObjectStorage({
  endpoint: requiredEnvironment("R2_ENDPOINT"),
  bucket: requiredEnvironment("R2_BUCKET"),
  accessKeyId: requiredEnvironment("R2_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnvironment("R2_SECRET_ACCESS_KEY"),
});

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  const runOperation =
    request.url === "/v1/operations/normalize"
      ? runNormalizeOperation
      : request.url === "/v1/operations/cleanup"
        ? runCleanupOperation
        : request.url === "/v1/operations/print-qa"
          ? runPrintQaOperation
          : undefined;
  if (request.method !== "POST" || !runOperation) {
    response.writeHead(404).end();
    return;
  }

  try {
    const operation = await readJsonRequest(request);
    const result = await runOperation(operation, storage);
    console.log(
      JSON.stringify({
        message: "image operation completed",
        operationId: result.operationId,
        artifactId: result.artifact.artifactId,
        status: result.status,
      })
    );
    sendJson(response, 200, result);
  } catch (error) {
    const status =
      error instanceof OperationInputError
        ? 400
        : error instanceof OperationConflictError
          ? 409
          : 500;
    console.error(
      JSON.stringify({
        message: "image operation failed",
        error: error instanceof Error ? error.message : String(error),
        status,
      })
    );
    sendJson(response, status, {
      error:
        status === 500
          ? "Image operation failed"
          : error instanceof Error
            ? error.message
            : String(error),
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(JSON.stringify({ message: "image worker ready", port }));
});

const readJsonRequest = async (
  request: IncomingMessage
): Promise<NormalizeOperationRequest> => {
  const chunks: Buffer[] = [];
  let byteSize = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    byteSize += buffer.byteLength;
    if (byteSize > maxRequestBytes) {
      throw new OperationInputError("Operation request is too large");
    }
    chunks.push(buffer);
  }

  try {
    return JSON.parse(
      Buffer.concat(chunks).toString("utf8")
    ) as NormalizeOperationRequest;
  } catch {
    throw new OperationInputError("Operation request must be valid JSON");
  }
};

const sendJson = (
  response: ServerResponse,
  status: number,
  body: unknown
): void => {
  const encoded = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": String(Buffer.byteLength(encoded)),
  });
  response.end(encoded);
};

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
