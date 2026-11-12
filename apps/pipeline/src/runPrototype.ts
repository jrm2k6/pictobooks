import { access, readdir, readFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProviderBundle } from "./config/providers.js";
import type { ProviderName } from "./config/providers.js";
import type { PageQaResult } from "./contracts/types.js";
import { removeDir, writeJson, writeText } from "./io/files.js";
import type { Logger } from "./io/logger.js";
import {
  createFileOperationClaims,
  createLocalArtifactStore,
  createLocalCandidateGenerator,
  createLocalCandidateProcessor,
  createLocalMetadataRepository,
  createLocalPhotoNormalizer,
} from "./adapters/local/localPipelineAdapters.js";
import { runPagePipeline } from "./core/pagePipeline.js";
import { deterministicIds, systemClock } from "./core/ports.js";
import { selectGenerationStyleReferences } from "./style/generationReferences.js";
import { loadCanonicalReferences } from "./style/styleJudge.js";

export type PrototypeOptions = {
  input?: string;
  inputDir?: string;
  out: string;
  style: "pictobook-preschool-v0.1";
  provider: ProviderName;
  catalog?: string;
  resume?: boolean;
};

type PhotoRunResult = {
  photo_id: string;
  input: string;
  status: "completed" | "needs_review" | "rejected";
  photo_dir: string;
  selected_candidate_uri: string | null;
  qa_results: {
    candidate_id: string;
    status: PageQaResult["status"];
    overall_score?: number;
  }[];
};

export const runPrototype = async (
  options: PrototypeOptions,
  logger: Logger
) => {
  const startedAt = new Date().toISOString();
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const outDir = resolve(invocationCwd, options.out);
  const inputPaths = await resolveInputs(options, invocationCwd);
  const providers = createProviderBundle(options.provider);
  const catalogRoot = options.catalog
    ? resolve(invocationCwd, options.catalog)
    : undefined;
  const canonicalReferences = catalogRoot
    ? await loadCanonicalReferences(catalogRoot, options.style)
    : [];
  const generationStyleReferences =
    selectGenerationStyleReferences(canonicalReferences);
  const styleReferenceUris = generationStyleReferences.map(reference =>
    pathToFileURL(reference.imagePath).toString()
  );
  const styleReferenceIds = generationStyleReferences.map(
    reference => reference.reviewId
  );

  if (!options.resume) {
    await removeDir(outDir);
  }

  logger.step("Starting prototype run", {
    inputs: inputPaths.length,
    out: outDir,
    style: options.style,
    provider: providers.config.name,
    style_reference_count: styleReferenceUris.length,
    style_reference_ids: styleReferenceIds,
    resume: options.resume ?? false,
  });

  await writeJson(join(outDir, "run.json"), {
    status: "running",
    started_at: startedAt,
    input: options.input ? resolve(invocationCwd, options.input) : undefined,
    input_dir: options.inputDir
      ? resolve(invocationCwd, options.inputDir)
      : undefined,
    photo_count: inputPaths.length,
    style_pack_version: options.style,
    provider: providers.config.name,
    vision_model: providers.config.visionModel,
    image_model: providers.config.imageModel,
    style_reference_ids: styleReferenceIds,
    resumed_at: options.resume ? startedAt : undefined,
  });

  await snapshotStyleBible(outDir, logger);

  const photoResults: PhotoRunResult[] = [];

  for (const [index, inputPath] of inputPaths.entries()) {
    const photoId = `photo_${String(index + 1).padStart(3, "0")}`;
    const photoDir = join(outDir, "photos", photoId.replace("_", "-"));
    const candidateDir = join(photoDir, "candidates");
    const resumedResult = options.resume
      ? await loadCompletedPhotoResult(photoDir, inputPath)
      : undefined;
    if (resumedResult) {
      logger.info("Skipping completed photo", {
        photo_id: photoId,
        candidates: resumedResult.qa_results.length,
      });
      photoResults.push(resumedResult);
      continue;
    }
    if (options.resume) {
      await removeDir(photoDir);
    }
    const photoResult = await runPhoto({
      inputPath,
      photoId,
      photoDir,
      candidateDir,
      providers,
      styleReferenceUris,
      logger,
    });
    await writeJson(join(photoDir, "photo-result.json"), photoResult);
    photoResults.push(photoResult);
  }

  const completedAt = new Date().toISOString();
  const completedCount = photoResults.filter(
    result => result.status === "completed"
  ).length;
  await writeJson(join(outDir, "run.json"), {
    status: completedCount > 0 ? "completed" : "needs_review",
    started_at: startedAt,
    completed_at: completedAt,
    input: options.input ? resolve(invocationCwd, options.input) : undefined,
    input_dir: options.inputDir
      ? resolve(invocationCwd, options.inputDir)
      : undefined,
    style_pack_version: options.style,
    provider: providers.config.name,
    vision_model: providers.config.visionModel,
    image_model: providers.config.imageModel,
    style_reference_ids: styleReferenceIds,
    photo_count: photoResults.length,
    completed_count: completedCount,
    photos: photoResults,
  });

  logger.step("Prototype run complete", {
    status: completedCount > 0 ? "completed" : "needs_review",
    out: outDir,
    photo_count: photoResults.length,
    completed_count: completedCount,
  });

  return {
    outDir,
    photoResults,
  };
};

export const runPhoto = async ({
  inputPath,
  photoId,
  photoDir,
  candidateDir,
  providers,
  styleReferenceUris,
  logger,
}: {
  inputPath: string;
  photoId: string;
  photoDir: string;
  candidateDir: string;
  providers: ReturnType<typeof createProviderBundle>;
  styleReferenceUris: string[];
  logger: Logger;
}): Promise<PhotoRunResult> => {
  logger.step("Processing photo", {
    photo_id: photoId,
    filename: basename(inputPath),
  });

  const artifacts = createLocalArtifactStore(photoDir);
  const result = await runPagePipeline({
    photoId,
    sourceUri: pathToFileURL(inputPath).toString(),
    styleReferenceUris,
    providerConfig: providers.config,
    visionProvider: providers.visionProvider,
    normalizer: createLocalPhotoNormalizer(photoDir, logger),
    candidateGenerator: createLocalCandidateGenerator(
      providers.imageProvider,
      candidateDir
    ),
    candidateProcessor: createLocalCandidateProcessor(candidateDir),
    metadata: createLocalMetadataRepository(artifacts),
    artifacts,
    operations: createFileOperationClaims(join(photoDir, "operations")),
    clock: systemClock,
    ids: deterministicIds,
    logger,
  });

  return {
    photo_id: result.photoId,
    input: inputPath,
    status: result.status,
    photo_dir: photoDir,
    selected_candidate_uri: result.selectedCandidateUri,
    qa_results: result.qaResults.map(qa => ({
      candidate_id: qa.candidate_id,
      status: qa.status,
      overall_score: qa.overall_score,
    })),
  };
};

const snapshotStyleBible = async (outDir: string, logger: Logger) => {
  const invocationCwd = process.env.INIT_CWD ?? process.cwd();
  const styleBiblePath = resolve(
    invocationCwd,
    "docs",
    "pictobook-preschool-style-bible.md"
  );

  try {
    const styleBible = await readFile(styleBiblePath, "utf8");
    await writeText(join(outDir, "style-bible.snapshot.md"), styleBible);
    logger.info("Style bible snapshot written", {
      source: styleBiblePath,
    });
  } catch {
    await writeText(
      join(outDir, "style-bible.snapshot.md"),
      "# Pictobook Preschool Style Bible\n\nSnapshot unavailable.\n"
    );
    logger.warn("Style bible snapshot unavailable", {
      expected: styleBiblePath,
    });
  }
};

const loadCompletedPhotoResult = async (
  photoDir: string,
  inputPath: string
): Promise<PhotoRunResult | undefined> => {
  const resultPath = join(photoDir, "photo-result.json");
  if (await exists(resultPath)) {
    return JSON.parse(await readFile(resultPath, "utf8")) as PhotoRunResult;
  }

  const requestPath = join(photoDir, "generation-request.json");
  const candidateDir = join(photoDir, "candidates");
  if (!(await exists(requestPath)) || !(await exists(candidateDir))) {
    return undefined;
  }
  const request = JSON.parse(await readFile(requestPath, "utf8")) as {
    photo_id?: string;
    model?: { params?: { candidate_count?: number } };
  };
  const expectedCount = request.model?.params?.candidate_count ?? 1;
  const qaFiles = (await readdir(candidateDir))
    .filter(file => /^candidate_\d+\.qa\.json$/.test(file))
    .sort();
  if (qaFiles.length !== expectedCount || !request.photo_id) {
    return undefined;
  }
  const qaResults = (await Promise.all(
    qaFiles.map(async file =>
      JSON.parse(await readFile(join(candidateDir, file), "utf8"))
    )
  )) as PageQaResult[];
  const selectedPath = join(photoDir, "selected.txt");
  const selectedCandidateUri = (await exists(selectedPath))
    ? (await readFile(selectedPath, "utf8")).trim() || null
    : null;
  const result: PhotoRunResult = {
    photo_id: request.photo_id,
    input: inputPath,
    status: selectedCandidateUri ? "completed" : "needs_review",
    photo_dir: photoDir,
    selected_candidate_uri: selectedCandidateUri,
    qa_results: qaResults.map(qa => ({
      candidate_id: qa.candidate_id,
      status: qa.status,
      overall_score: qa.overall_score,
    })),
  };
  await writeJson(resultPath, result);
  return result;
};

const exists = async (path: string) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const resolveInputs = async (
  options: PrototypeOptions,
  invocationCwd: string
) => {
  if (options.input) {
    return [resolve(invocationCwd, options.input)];
  }

  if (!options.inputDir) {
    throw new Error("Either --input or --input-dir is required");
  }

  const inputDir = resolve(invocationCwd, options.inputDir);
  const entries = await readdir(inputDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => join(inputDir, entry.name))
    .filter(path => supportedImageExtensions.has(extname(path).toLowerCase()))
    .sort();
};

const supportedImageExtensions = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
]);
