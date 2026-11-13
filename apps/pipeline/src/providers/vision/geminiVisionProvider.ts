import type {
  DetectedSubject,
  PhotoAnalysis,
  PhotoStatus,
  RejectionReason,
} from "../../contracts/types.js";
import {
  geminiResponseParts,
  generateGeminiContent,
  readFileUriAsInlineData,
} from "../gemini/geminiClient.js";
import type { VisionProvider } from "./VisionProvider.js";

type GeminiPhotoAnalysis = {
  status?: PhotoStatus;
  rejection_reasons?: RejectionReason[];
  rejection_message?: string;
  scene_summary?: string;
  subjects?: DetectedSubject[];
  keep?: string[];
  remove?: string[];
  analysis_confidence?: number;
  quality_notes?: string[];
};

export const createGeminiVisionProvider = (model: string): VisionProvider => ({
  async analyzePhoto(input) {
    const imagePart = await readFileUriAsInlineData(input.normalizedUri);
    const response = await generateGeminiContent({
      model,
      parts: [
        {
          text: buildAnalysisPrompt(
            input.imageProperties.width_px,
            input.imageProperties.height_px
          ),
        },
        imagePart,
      ],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
      },
    });
    const text = geminiResponseParts(response).find(part => part.text)?.text;
    if (!text) {
      throw new Error("Gemini vision response did not contain JSON text.");
    }

    const analysis = parseAnalysis(text);
    return toPhotoAnalysis(input, analysis);
  },
});

const buildAnalysisPrompt = (width: number, height: number) => `
Analyze this family photo for conversion into a simple children's coloring page.
Return JSON only. Coordinates must be pixel coordinates within ${width}x${height}.

Required shape:
{
  "status": "accepted" | "rejected" | "needs_review",
  "rejection_reasons": ["too_blurry" | "too_dark" | "too_cluttered" | "face_occluded" | "too_many_subjects" | "unsafe_content" | "low_resolution" | "no_clear_subject" | "generation_unsuitable"],
  "rejection_message": "short parent-friendly explanation",
  "scene_summary": "literal concise description",
  "subjects": [{
    "local_id": "person_1",
    "type": "person" | "pet" | "object" | "other" | "unknown",
    "centrality": "primary" | "secondary" | "incidental",
    "description": "visible identity cues without guessing sensitive traits",
    "action": "visible action",
    "visible_cues": {
      "hair": "visible hair cues",
      "face": "visible face cues",
      "eyes": "visible eye cues",
      "accessories": ["visible accessory"],
      "clothing": "visible clothing",
      "body_or_silhouette": "visible silhouette",
      "pet_markings": "visible pet markings",
      "other": ["other useful cue"]
    },
    "semantic_color_cues": [{"target":"item", "color":"visible color", "importance":"low" | "medium" | "high"}],
    "bounding_box": {"x":0,"y":0,"width":100,"height":100},
    "confidence": 0.9
  }],
  "keep": ["essential subjects and recognizable cues"],
  "remove": ["clutter safe to omit"],
  "analysis_confidence": 0.9,
  "quality_notes": ["brief factual notes"]
}

Accept clear, safe photos with one or more recognizable main subjects. Use needs_review for borderline quality. Never identify people or infer names, ethnicity, health, religion, or other sensitive traits.`;

const parseAnalysis = (text: string): GeminiPhotoAnalysis => {
  try {
    return JSON.parse(text) as GeminiPhotoAnalysis;
  } catch {
    throw new Error("Gemini vision response was not valid JSON.");
  }
};

const toPhotoAnalysis = (
  input: Parameters<VisionProvider["analyzePhoto"]>[0],
  analysis: GeminiPhotoAnalysis
): PhotoAnalysis => {
  const status: PhotoStatus = ["accepted", "rejected", "needs_review"].includes(
    analysis.status ?? ""
  )
    ? (analysis.status as PhotoStatus)
    : "needs_review";
  const rejectionReasons = analysis.rejection_reasons ?? [];

  return {
    schema_version: "2026-09-16",
    photo_id: input.photoId,
    source_uri: input.sourceUri,
    status,
    rejection:
      status === "accepted"
        ? undefined
        : {
            reasons:
              rejectionReasons.length > 0
                ? rejectionReasons
                : ["generation_unsuitable"],
            severity: status === "rejected" ? "hard" : "soft",
            retryable_with_new_photo: true,
            message:
              analysis.rejection_message ?? "This photo needs a closer review.",
          },
    image_properties: input.imageProperties,
    scene_summary: analysis.scene_summary,
    subjects: analysis.subjects,
    keep: analysis.keep,
    remove: analysis.remove,
    composition_freedom: "reinterpret_cleanly",
    analysis_confidence: analysis.analysis_confidence,
    quality_notes: analysis.quality_notes,
    created_at: new Date().toISOString(),
  };
};
