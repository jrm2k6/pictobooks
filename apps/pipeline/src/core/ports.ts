import type {
  GeneratedImage,
  GenerationRequest,
  ImageProperties,
  PageBrief,
  PageQaResult,
  PhotoAnalysis,
  PrintFitness,
} from "../contracts/types.js";

export type NormalizedPhoto = {
  photoId: string;
  sourceUri: string;
  normalizedUri: string;
  imageProperties: ImageProperties;
};

export type ArtifactStore = {
  putJson(key: string, value: unknown): Promise<void>;
  putText(key: string, value: string): Promise<void>;
};

export type MetadataRepository = {
  savePhotoAnalysis(value: PhotoAnalysis): Promise<void>;
  savePageBrief(value: PageBrief): Promise<void>;
  saveGenerationRequest(value: GenerationRequest): Promise<void>;
  saveCandidateQa(candidateId: string, value: PageQaResult): Promise<void>;
};

export type PhotoNormalizer = {
  normalize(input: {
    photoId: string;
    sourceUri: string;
  }): Promise<NormalizedPhoto>;
};

export type CandidateProcessor = {
  cleanup(candidate: GeneratedImage): Promise<GeneratedImage>;
  measure(uri: string): Promise<PrintFitness>;
};

export type CandidateGenerator = {
  generate(request: GenerationRequest): Promise<GeneratedImage[]>;
};

export type OperationClaims = {
  run<T>(operationId: string, operation: () => Promise<T>): Promise<T>;
};

export type Clock = { now(): string };
export type IdGenerator = {
  generationRequestId(pageId: string, attempt: number): string;
  generationOperationId(requestId: string): string;
};

export const systemClock: Clock = { now: () => new Date().toISOString() };

export const deterministicIds: IdGenerator = {
  generationRequestId: (pageId, attempt) =>
    `${pageId}_gen_req_${String(attempt).padStart(3, "0")}`,
  generationOperationId: requestId => `generate:${requestId}`,
};
