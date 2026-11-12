import type { ImageProvider } from "../providers/image/ImageProvider.js";
import { mockImageProvider } from "../providers/image/mockImageProvider.js";
import { createGeminiImageProvider } from "../providers/image/geminiImageProvider.js";
import type { VisionProvider } from "../providers/vision/VisionProvider.js";
import { createGeminiVisionProvider } from "../providers/vision/geminiVisionProvider.js";
import { mockVisionProvider } from "../providers/vision/mockVisionProvider.js";

export type ProviderName =
  | "mock"
  | "openai"
  | "gemini"
  | "bfl"
  | "recraft"
  | "stability"
  | "adobe_firefly";

export type ProviderConfig = {
  name: ProviderName;
  visionModel: string;
  imageModel: string;
  apiBaseUrl?: string;
};

export type ProviderBundle = {
  config: ProviderConfig;
  visionProvider: VisionProvider;
  imageProvider: ImageProvider;
};

export const providerNames: ProviderName[] = [
  "mock",
  "openai",
  "gemini",
  "bfl",
  "recraft",
  "stability",
  "adobe_firefly",
];

export const isProviderName = (value: string): value is ProviderName =>
  providerNames.includes(value as ProviderName);

export const providerNameFromEnv = (): ProviderName =>
  providerNameOrDefault(process.env.PICTOBOOK_PIPELINE_PROVIDER, "mock");

export const createProviderBundle = (name: ProviderName): ProviderBundle => {
  if (name === "mock") {
    return {
      config: {
        name,
        visionModel: "mock-vision-analyzer",
        imageModel: "mock-coloring-page-generator",
      },
      visionProvider: mockVisionProvider,
      imageProvider: mockImageProvider,
    };
  }

  if (name === "gemini") {
    assertProviderEnv(name);
    const visionModel = process.env.GEMINI_VISION_MODEL ?? "gemini-3.8-flash";
    const imageModel =
      process.env.GEMINI_IMAGE_MODEL ?? "gemini-nano-banana-2.1";
    return {
      config: {
        name,
        visionModel,
        imageModel,
        apiBaseUrl: process.env.GEMINI_API_BASE_URL,
      },
      visionProvider: createGeminiVisionProvider(visionModel),
      imageProvider: createGeminiImageProvider(imageModel),
    };
  }

  assertProviderEnv(name);
  throw new Error(
    `Provider "${name}" is configured but not implemented yet. The env harness is ready; add provider adapters under apps/pipeline/src/providers/.`
  );
};

const providerNameOrDefault = (
  value: string | undefined,
  fallback: ProviderName
) => {
  if (!value) {
    return fallback;
  }
  if (!isProviderName(value)) {
    throw new Error(
      `Unsupported provider "${value}". Expected one of: ${providerNames.join(", ")}.`
    );
  }
  return value;
};

const assertProviderEnv = (name: Exclude<ProviderName, "mock">) => {
  const requiredByProvider: Record<Exclude<ProviderName, "mock">, string[]> = {
    openai: ["OPENAI_API_KEY"],
    gemini: ["GEMINI_API_KEY"],
    bfl: ["BFL_API_KEY"],
    recraft: ["RECRAFT_API_KEY"],
    stability: ["STABILITY_API_KEY"],
    adobe_firefly: ["ADOBE_FIREFLY_CLIENT_ID", "ADOBE_FIREFLY_CLIENT_SECRET"],
  };

  const missing = requiredByProvider[name].filter(key => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(
      `Provider "${name}" is missing required env: ${missing.join(", ")}. Copy apps/pipeline/.env.example to apps/pipeline/.env.development and fill the values.`
    );
  }
};
