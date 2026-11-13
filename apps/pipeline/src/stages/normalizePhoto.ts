import { basename, join } from "node:path";
import { copy } from "../io/files.js";
import { normalizeToPng } from "../io/imageMetrics.js";
import type { Logger } from "../io/logger.js";
import type { ImageProperties } from "../contracts/types.js";

export type NormalizedPhoto = {
  photoId: string;
  inputPath: string;
  normalizedPath: string;
  sourceUri: string;
  imageProperties: ImageProperties;
};

export const normalizePhoto = async (
  inputPath: string,
  photoDir: string,
  photoId: string,
  logger: Logger
): Promise<NormalizedPhoto> => {
  const normalizedPath = join(photoDir, "normalized.png");
  const inputCopyPath = join(photoDir, basename(inputPath));

  logger.step("1. Intake and normalize", {
    photo_id: photoId,
    input: inputPath,
  });

  await copy(inputPath, inputCopyPath);
  const imageProperties = await normalizeToPng(inputPath, normalizedPath);

  logger.info("Photo copied and normalized into run artifacts", {
    input_copy: inputCopyPath,
    normalized: normalizedPath,
    width_px: imageProperties.width_px,
    height_px: imageProperties.height_px,
    mime_type: imageProperties.mime_type,
  });

  return {
    photoId,
    inputPath,
    normalizedPath,
    sourceUri: `file://${inputPath}`,
    imageProperties,
  };
};
