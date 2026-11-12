import { basename, join } from "node:path";
import type { GeneratedImage } from "../contracts/types.js";
import { cleanupToBlackAndWhite } from "../io/imageMetrics.js";

export const cleanupImage = async (
  candidate: GeneratedImage,
  candidateDir: string
): Promise<GeneratedImage> => {
  const cleanedUri = join(
    candidateDir,
    `${basename(candidate.uri, ".png")}.cleaned.png`
  );

  await cleanupToBlackAndWhite(candidate.uri, cleanedUri);

  return {
    ...candidate,
    uri: cleanedUri,
  };
};
