import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRunLabel } from "../io/runIdentity.js";

export type ReviewStatus = "approved" | "rejected" | "superseded";

export type CandidateReview = {
  schema_version: "2026-10-27";
  review_id: string;
  status: ReviewStatus;
  canonical: boolean;
  style_pack_version: string;
  reviewer_notes: string;
  reviewed_at: string;
  source_run: string;
  source_run_label: string;
  photo_id: string;
  candidate_id: string;
  candidate_image_uri: string;
  catalog_page_dir?: string;
};

export type SaveReviewInput = {
  runDir: string;
  catalogRoot: string;
  photoId: string;
  candidateId: string;
  status: Exclude<ReviewStatus, "superseded">;
  canonical: boolean;
  notes: string;
};

type JsonObject = Record<string, unknown>;

export const saveCandidateReview = async (
  input: SaveReviewInput
): Promise<CandidateReview> => {
  assertArtifactId(input.photoId, "photo");
  assertArtifactId(input.candidateId, "candidate");
  const photoDir = resolve(input.runDir, "photos", input.photoId);
  assertInside(input.runDir, photoDir);
  const candidateDir = join(photoDir, "candidates");
  const qaPath = join(candidateDir, `${input.candidateId}.qa.json`);
  const qa = await readJsonObject(qaPath);
  const candidateImageUri = stringValue(qa["generated_image_uri"]);
  if (!candidateImageUri) {
    throw new Error("Candidate QA does not reference a generated image.");
  }
  const candidateImagePath = localPath(candidateImageUri);
  assertInside(input.runDir, candidateImagePath);

  const pageBrief = await readJsonObject(join(photoDir, "page-brief.json"));
  const stylePackVersion = stringValue(pageBrief["style_pack_version"]);
  if (!stylePackVersion) {
    throw new Error("Page brief does not specify a style pack version.");
  }
  if (input.status === "rejected" && input.canonical) {
    throw new Error("A rejected candidate cannot be a canonical reference.");
  }

  if (input.status === "approved") {
    await supersedeOtherApprovals({
      candidateDir,
      candidateId: input.candidateId,
      catalogRoot: input.catalogRoot,
    });
  }

  const reviewId = createReviewId(
    input.runDir,
    input.photoId,
    input.candidateId
  );
  const catalogPageDir = join(
    input.catalogRoot,
    stylePackVersion,
    "pages",
    reviewId
  );
  const review: CandidateReview = {
    schema_version: "2026-10-27",
    review_id: reviewId,
    status: input.status,
    canonical: input.status === "approved" && input.canonical,
    style_pack_version: stylePackVersion,
    reviewer_notes: input.notes.trim(),
    reviewed_at: new Date().toISOString(),
    source_run: input.runDir,
    source_run_label: await resolveRunLabel(input.runDir),
    photo_id: input.photoId,
    candidate_id: input.candidateId,
    candidate_image_uri: candidateImageUri,
    catalog_page_dir: input.status === "approved" ? catalogPageDir : undefined,
  };

  await writeJsonAtomic(
    join(candidateDir, `${input.candidateId}.review.json`),
    review
  );

  if (input.status === "approved") {
    await mkdir(catalogPageDir, { recursive: true });
    await copyFile(candidateImagePath, join(catalogPageDir, "image.png"));
    await copyFile(
      join(photoDir, "normalized.png"),
      join(catalogPageDir, "source-thumbnail.png")
    );
    await writeJsonAtomic(join(catalogPageDir, "review.json"), review);
  } else {
    await updateCatalogReviewIfPresent(input.catalogRoot, review);
  }

  await rebuildCatalogIndexes(input.catalogRoot, stylePackVersion);
  return review;
};

const supersedeOtherApprovals = async ({
  candidateDir,
  candidateId,
  catalogRoot,
}: {
  candidateDir: string;
  candidateId: string;
  catalogRoot: string;
}) => {
  const files = await readdir(candidateDir);
  for (const file of files.filter(
    name =>
      name.endsWith(".review.json") && name !== `${candidateId}.review.json`
  )) {
    const path = join(candidateDir, file);
    const existing = (await readJsonObject(path)) as CandidateReview;
    if (existing.status !== "approved") {
      continue;
    }
    const superseded: CandidateReview = {
      ...existing,
      status: "superseded",
      canonical: false,
      reviewed_at: new Date().toISOString(),
    };
    await writeJsonAtomic(path, superseded);
    await updateCatalogReviewIfPresent(catalogRoot, superseded);
  }
};

const updateCatalogReviewIfPresent = async (
  catalogRoot: string,
  review: CandidateReview
) => {
  const path = join(
    catalogRoot,
    review.style_pack_version,
    "pages",
    review.review_id,
    "review.json"
  );
  try {
    await readFile(path);
    await writeJsonAtomic(path, review);
  } catch {
    // Rejected candidates that were never approved have no catalogue page.
  }
};

export const rebuildCatalogIndexes = async (
  catalogRoot: string,
  stylePackVersion: string
) => {
  const styleRoot = join(catalogRoot, stylePackVersion);
  const pagesRoot = join(styleRoot, "pages");
  const entries = await readdir(pagesRoot, { withFileTypes: true }).catch(
    () => []
  );
  const reviews: CandidateReview[] = [];

  for (const entry of entries.filter(item => item.isDirectory())) {
    try {
      const review = (await readJsonObject(
        join(pagesRoot, entry.name, "review.json")
      )) as CandidateReview;
      if (!review.source_run_label) {
        review.source_run_label = await resolveRunLabel(review.source_run);
        await writeJsonAtomic(
          join(pagesRoot, entry.name, "review.json"),
          review
        );
      }
      if (review.status === "approved") {
        reviews.push(review);
      }
    } catch {
      // Ignore incomplete catalogue entries; they remain inspectable on disk.
    }
  }

  reviews.sort((left, right) =>
    left.reviewed_at.localeCompare(right.reviewed_at)
  );
  await writeJsonAtomic(join(styleRoot, "approved.json"), {
    schema_version: "2026-10-27",
    style_pack_version: stylePackVersion,
    updated_at: new Date().toISOString(),
    pages: reviews,
  });
  await writeJsonAtomic(join(styleRoot, "canonical.json"), {
    schema_version: "2026-10-27",
    style_pack_version: stylePackVersion,
    updated_at: new Date().toISOString(),
    pages: reviews.filter(review => review.canonical),
  });
};

const createReviewId = (
  runDir: string,
  photoId: string,
  candidateId: string
) => {
  const digest = createHash("sha256")
    .update(`${resolve(runDir)}:${photoId}:${candidateId}`)
    .digest("hex")
    .slice(0, 12);
  return `${photoId}-${candidateId}-${digest}`;
};

const localPath = (uri: string) =>
  uri.startsWith("file://") ? fileURLToPath(uri) : resolve(uri);

const readJsonObject = async (path: string): Promise<JsonObject> => {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected a JSON object in ${basename(path)}.`);
  }
  return value as JsonObject;
};

const writeJsonAtomic = async (path: string, value: unknown) => {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
};

const assertInside = (root: string, candidate: string) => {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (relativePath.startsWith("..") || relativePath.startsWith("/")) {
    throw new Error("Review target is outside the selected run.");
  }
};

const assertArtifactId = (value: string, label: string) => {
  if (!/^[a-z0-9_-]+$/i.test(value)) {
    throw new Error(`Invalid ${label} identifier.`);
  }
};

const stringValue = (value: unknown) =>
  typeof value === "string" ? value : "";
