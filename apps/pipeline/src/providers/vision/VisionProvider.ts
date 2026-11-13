import type { ImageProperties, PhotoAnalysis } from "../../contracts/types.js";

export type AnalyzePhotoInput = {
  photoId: string;
  sourceUri: string;
  normalizedUri: string;
  imageProperties: ImageProperties;
};

export type VisionProvider = {
  analyzePhoto(input: AnalyzePhotoInput): Promise<PhotoAnalysis>;
};
