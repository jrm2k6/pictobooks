import type {
  GenerationRequest,
  PageBrief,
  RepairReason,
} from "../contracts/types.js";
import {
  NEGATIVE_STYLE_PROMPT,
  POSITIVE_STYLE_PROMPT,
} from "../style/pictobookPreschoolV01.js";
import type { ProviderConfig } from "../config/providers.js";

export const createGenerationRequest = (
  pageBrief: PageBrief,
  attempt: number,
  provider: ProviderConfig,
  previousFailureCodes: RepairReason[] = [],
  repairInstruction?: string,
  sourceImageUri = pageBrief.source_uri,
  styleReferenceUris: string[] = [],
  requestId = `${pageBrief.page_id}_gen_req_${String(attempt).padStart(3, "0")}`
): GenerationRequest => ({
  schema_version: "2026-09-16",
  request_id: requestId,
  page_id: pageBrief.page_id,
  photo_id: pageBrief.photo_id,
  attempt,
  style_pack_version: pageBrief.style_pack_version,
  output: {
    format: "png",
    width_px: 2480,
    height_px: 3508,
    background: "white",
    color_mode: "black_and_white",
  },
  inputs: {
    page_brief: pageBrief.final_brief,
    source_image_uri: sourceImageUri,
    style_reference_uris:
      styleReferenceUris.length > 0 ? styleReferenceUris : undefined,
  },
  prompt: {
    positive: `${POSITIVE_STYLE_PROMPT} ${pageBrief.final_brief}`,
    negative: NEGATIVE_STYLE_PROMPT,
  },
  model: {
    provider: provider.name,
    name: provider.imageModel,
    params: {
      candidate_count: 3,
      quality: provider.name === "mock" ? "draft" : "high",
      provider_specific: {
        api_base_url: provider.apiBaseUrl,
        deterministic_mock: provider.name === "mock" ? true : undefined,
        style_reference_count: styleReferenceUris.length,
      },
    },
  },
  retry_context:
    previousFailureCodes.length > 0 || repairInstruction
      ? {
          previous_failure_codes: previousFailureCodes,
          repair_instruction: repairInstruction,
        }
      : undefined,
});
