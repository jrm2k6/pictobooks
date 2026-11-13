import type {
  GeneratedImage,
  GenerationRequest,
} from "../../contracts/types.js";

export type GeneratePageInput = {
  request: GenerationRequest;
  candidateDir: string;
  candidateStartIndex?: number;
};

export type ImageProvider = {
  generatePage(input: GeneratePageInput): Promise<GeneratedImage[]>;
};
