import type { ProviderConfig } from "../config/providers.js";
import type { PageQaResult } from "../contracts/types.js";
import type { Logger } from "../io/logger.js";
import type { VisionProvider } from "../providers/vision/VisionProvider.js";
import { createGenerationRequest } from "../stages/createGenerationRequest.js";
import { createPageBrief } from "../stages/createPageBrief.js";
import { createRepairInstruction } from "../stages/createRepairInstruction.js";
import { qaPage } from "../stages/qaPage.js";
import type {
  ArtifactStore,
  CandidateGenerator,
  CandidateProcessor,
  Clock,
  IdGenerator,
  MetadataRepository,
  OperationClaims,
  PhotoNormalizer,
} from "./ports.js";

export type PagePipelineResult = {
  photoId: string;
  status: "completed" | "rejected" | "needs_review";
  selectedCandidateUri: string | null;
  qaResults: PageQaResult[];
};

export const runPagePipeline = async (input: {
  photoId: string;
  sourceUri: string;
  styleReferenceUris: string[];
  providerConfig: ProviderConfig;
  visionProvider: VisionProvider;
  normalizer: PhotoNormalizer;
  candidateGenerator: CandidateGenerator;
  candidateProcessor: CandidateProcessor;
  metadata: MetadataRepository;
  artifacts: ArtifactStore;
  operations: OperationClaims;
  clock: Clock;
  ids: IdGenerator;
  logger: Logger;
}): Promise<PagePipelineResult> => {
  const normalized = await input.normalizer.normalize({
    photoId: input.photoId,
    sourceUri: input.sourceUri,
  });
  const analysis = await input.visionProvider.analyzePhoto({
    photoId: normalized.photoId,
    sourceUri: normalized.sourceUri,
    normalizedUri: normalized.normalizedUri,
    imageProperties: normalized.imageProperties,
  });
  await input.metadata.savePhotoAnalysis(analysis);

  if (analysis.status !== "accepted") {
    return {
      photoId: normalized.photoId,
      status: analysis.status === "rejected" ? "rejected" : "needs_review",
      selectedCandidateUri: null,
      qaResults: [],
    };
  }

  const pageBrief = createPageBrief(analysis);
  await input.metadata.savePageBrief(pageBrief);
  const request = createGenerationRequest(
    pageBrief,
    1,
    input.providerConfig,
    [],
    undefined,
    normalized.normalizedUri,
    input.styleReferenceUris,
    input.ids.generationRequestId(pageBrief.page_id, 1)
  );
  await input.metadata.saveGenerationRequest(request);

  const candidates = await input.operations.run(
    input.ids.generationOperationId(request.request_id),
    () => input.candidateGenerator.generate(request)
  );
  const qaResults: PageQaResult[] = [];
  let selectedCandidateUri: string | undefined;
  let selectedQa: PageQaResult | undefined;

  for (const candidate of candidates) {
    const cleaned = await input.candidateProcessor.cleanup(candidate);
    const fitness = await input.candidateProcessor.measure(cleaned.uri);
    const qa = qaPage(pageBrief, request, cleaned, fitness);
    qaResults.push(qa);
    await input.metadata.saveCandidateQa(candidate.candidate_id, qa);
    if (qa.status === "passed" && !selectedCandidateUri) {
      selectedCandidateUri = cleaned.uri;
      selectedQa = qa;
    } else if (qa.status !== "passed") {
      const repair = createRepairInstruction(qa);
      await input.artifacts.putJson(
        `candidates/${candidate.candidate_id}.repair.json`,
        {
          repair_instruction: repair.repairInstruction,
          retry_decision: repair.retryDecision,
          created_at: input.clock.now(),
        }
      );
    }
  }

  if (selectedCandidateUri && selectedQa) {
    await input.artifacts.putText("selected.txt", `${selectedCandidateUri}\n`);
    await input.artifacts.putJson("selected.qa.json", selectedQa);
  }
  return {
    photoId: normalized.photoId,
    status: selectedCandidateUri ? "completed" : "needs_review",
    selectedCandidateUri: selectedCandidateUri ?? null,
    qaResults,
  };
};
