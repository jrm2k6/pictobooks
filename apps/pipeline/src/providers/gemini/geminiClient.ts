import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export type GeminiPart = {
  text?: string;
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
};

type GeminiResponse = {
  candidates?: {
    content?: {
      parts?: GeminiPart[];
    };
    finishReason?: string;
  }[];
  promptFeedback?: {
    blockReason?: string;
  };
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

const DEFAULT_API_BASE_URL = "https://generativelanguage.googleapis.com/v1";

export const generateGeminiContent = async ({
  model,
  parts,
  generationConfig,
}: {
  model: string;
  parts: GeminiPart[];
  generationConfig?: Record<string, unknown>;
}): Promise<GeminiResponse> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for the Gemini provider.");
  }

  const apiBaseUrl = (
    process.env.GEMINI_API_BASE_URL ?? DEFAULT_API_BASE_URL
  ).replace(/\/$/, "");
  const url = `${apiBaseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig,
    }),
  });

  const payload = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    const detail = payload.error?.message ?? response.statusText;
    throw new Error(
      `Gemini API request failed (${response.status}): ${detail}`
    );
  }

  return payload;
};

export const geminiResponseParts = (response: GeminiResponse): GeminiPart[] => {
  const parts = response.candidates?.[0]?.content?.parts;
  if (parts && parts.length > 0) {
    return parts;
  }

  const reason =
    response.promptFeedback?.blockReason ??
    response.candidates?.[0]?.finishReason ??
    "no content returned";
  throw new Error(`Gemini API returned no usable content: ${reason}.`);
};

export const readFileUriAsInlineData = async (
  uri: string,
  mimeType = "image/png"
): Promise<GeminiPart> => {
  if (!uri.startsWith("file://")) {
    throw new Error(`Gemini adapter only supports local file URIs: ${uri}`);
  }

  const data = await readFile(fileURLToPath(uri));
  return {
    inlineData: {
      mimeType,
      data: data.toString("base64"),
    },
  };
};
