import type { VisionProvider } from "./VisionProvider.js";

export const mockVisionProvider: VisionProvider = {
  async analyzePhoto(input) {
    return {
      schema_version: "2026-09-16",
      photo_id: input.photoId,
      source_uri: input.sourceUri,
      status: "accepted",
      image_properties: input.imageProperties,
      scene_summary: "a child sitting on a beach holding a bucket",
      subjects: [
        {
          local_id: "person_1",
          type: "person",
          centrality: "primary",
          description:
            "child with short curly hair, round glasses, and a striped shirt",
          action: "sitting on the sand and holding a bucket",
          bounding_box: {
            x: 420,
            y: 380,
            width: 1180,
            height: 2100,
          },
          confidence: 0.91,
          visible_cues: {
            hair: "short curly hair",
            face: "small round face",
            accessories: ["round glasses"],
            clothing: "striped shirt",
          },
          semantic_color_cues: [
            { target: "glasses", color: "dark frames", importance: "high" },
            { target: "bucket", color: "blue", importance: "high" },
            {
              target: "shirt",
              color: "red and white striped",
              importance: "medium",
            },
          ],
        },
        {
          local_id: "object_1",
          type: "object",
          centrality: "secondary",
          description: "small beach bucket",
          action: "held by the child",
          bounding_box: {
            x: 1500,
            y: 2100,
            width: 420,
            height: 520,
          },
          confidence: 0.86,
          semantic_color_cues: [
            { target: "bucket", color: "blue", importance: "high" },
          ],
        },
      ],
      keep: ["child", "bucket", "simple sand shape", "two small wave lines"],
      remove: ["beach crowd", "chairs", "busy towel pattern"],
      composition_freedom: "reinterpret_cleanly",
      analysis_confidence: 0.88,
      quality_notes: [
        "mock analysis",
        "good lighting",
        "main subject visible",
        `normalized_uri=${input.normalizedUri}`,
      ],
      created_at: new Date().toISOString(),
    };
  },
};
