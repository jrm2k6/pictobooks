import { access, readFile, rename, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ImageProvider } from "../../providers/image/ImageProvider.js";
import type {
  ArtifactStore,
  CandidateGenerator,
  CandidateProcessor,
  MetadataRepository,
  OperationClaims,
  PhotoNormalizer,
} from "../../core/ports.js";
import { copy, ensureDir, writeJson, writeText } from "../../io/files.js";
import type { Logger } from "../../io/logger.js";
import { measurePrintFitness, normalizeToPng } from "../../io/imageMetrics.js";
import { cleanupImage } from "../../stages/cleanupImage.js";

export const createLocalArtifactStore = (photoDir: string): ArtifactStore => ({
  putJson: (key, value) => writeJson(join(photoDir, key), value),
  putText: (key, value) => writeText(join(photoDir, key), value),
});

export const createLocalMetadataRepository = (
  store: ArtifactStore
): MetadataRepository => ({
  savePhotoAnalysis: value => store.putJson("photo-analysis.json", value),
  savePageBrief: value => store.putJson("page-brief.json", value),
  saveGenerationRequest: value =>
    store.putJson("generation-request.json", value),
  saveCandidateQa: (id, value) =>
    store.putJson(`candidates/${id}.qa.json`, value),
});

export const createLocalPhotoNormalizer = (
  photoDir: string,
  logger: Logger
): PhotoNormalizer => ({
  async normalize({ photoId, sourceUri }) {
    const path = sourceUri.startsWith("file://")
      ? fileURLToPath(sourceUri)
      : sourceUri;
    const normalizedPath = join(photoDir, "normalized.png");
    await copy(path, join(photoDir, basename(path)));
    const imageProperties = await normalizeToPng(path, normalizedPath);
    logger.info("Photo copied and normalized into run artifacts", {
      photo_id: photoId,
      normalized: normalizedPath,
    });
    return {
      photoId,
      sourceUri: pathToFileURL(path).toString(),
      normalizedUri: pathToFileURL(normalizedPath).toString(),
      imageProperties,
    };
  },
});

export const createLocalCandidateGenerator = (
  provider: ImageProvider,
  candidateDir: string
): CandidateGenerator => ({
  generate: request => provider.generatePage({ request, candidateDir }),
});

export const createLocalCandidateProcessor = (
  candidateDir: string
): CandidateProcessor => ({
  cleanup: candidate => cleanupImage(candidate, candidateDir),
  measure: measurePrintFitness,
});

type CompletedClaim<T> = { status: "completed"; value: T };

export const createFileOperationClaims = (root: string): OperationClaims => ({
  async run<T>(operationId: string, operation: () => Promise<T>) {
    const safeId = operationId.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const path = join(root, `${safeId}.json`);
    if (await fileExists(path)) {
      return (JSON.parse(await readFile(path, "utf8")) as CompletedClaim<T>)
        .value;
    }
    const value = await operation();
    await ensureDir(root);
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ status: "completed", value }, null, 2)}\n`
    );
    await rename(temporary, path);
    return value;
  },
});

const fileExists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

export const inMemoryOperationClaims = (): OperationClaims => {
  const completed = new Map<string, unknown>();
  return {
    async run<T>(id: string, operation: () => Promise<T>) {
      if (completed.has(id)) return completed.get(id) as T;
      const value = await operation();
      completed.set(id, value);
      return value;
    },
  };
};
