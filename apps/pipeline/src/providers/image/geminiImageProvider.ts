import { join } from "node:path";
import sharp from "sharp";
import { ensureDir } from "../../io/files.js";
import {
  geminiResponseParts,
  generateGeminiContent,
  readFileUriAsInlineData,
} from "../gemini/geminiClient.js";
import type { ImageProvider } from "./ImageProvider.js";

export const createGeminiImageProvider = (model: string): ImageProvider => ({
  async generatePage(input) {
    const sourceUri = input.request.inputs.source_image_uri;
    if (!sourceUri) {
      throw new Error("Gemini image generation requires source_image_uri.");
    }

    await ensureDir(input.candidateDir);
    const sourceImage = await readFileUriAsInlineData(sourceUri);
    const styleReferences = await Promise.all(
      (input.request.inputs.style_reference_uris ?? []).map(uri =>
        readFileUriAsInlineData(uri)
      )
    );
    const repairReference = input.request.inputs.repair_reference_uri
      ? await readFileUriAsInlineData(input.request.inputs.repair_reference_uri)
      : undefined;
    const candidateCount = input.request.model.params?.candidate_count ?? 1;
    const candidates = [];

    const startIndex = input.candidateStartIndex ?? 1;
    for (let offset = 0; offset < candidateCount; offset += 1) {
      const index = startIndex + offset;
      const candidateId = `candidate_${String(index).padStart(3, "0")}`;
      const response = await generateGeminiContent({
        model,
        parts: [
          {
            text: buildImagePrompt(
              input.request.prompt.positive,
              input.request.prompt.negative,
              index
            ),
          },
          sourceImage,
          ...(repairReference
            ? [
                {
                  text: "The next image is the previous best candidate. Use it only as a repair reference: preserve the successful traits named in the repair instructions while correcting the listed defects. The source photo remains authoritative for identity and scene content.",
                },
                repairReference,
              ]
            : []),
          ...(styleReferences.length > 0
            ? [
                {
                  text: "The remaining images are style-only references. Match their line weight, facial simplification, proportions, detail density, and open coloring regions. Do not copy their people, animals, objects, poses, or backgrounds.",
                },
                ...styleReferences,
              ]
            : []),
        ],
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "2:3",
            imageSize: "2K",
          },
        },
      });
      const image = geminiResponseParts(response).find(
        part => part.inlineData?.data
      )?.inlineData;
      if (!image?.data) {
        throw new Error(
          `Gemini image response contained no image for ${candidateId}.`
        );
      }

      const uri = join(input.candidateDir, `${candidateId}.png`);
      await sharp(Buffer.from(image.data, "base64"))
        .flatten({ background: "white" })
        .resize(2480, 3508, {
          fit: "contain",
          background: "white",
          withoutEnlargement: false,
        })
        .png()
        .toFile(uri);

      candidates.push({
        candidate_id: candidateId,
        uri,
        width_px: 2480 as const,
        height_px: 3508 as const,
      });
    }

    return candidates;
  },
});

const buildImagePrompt = (
  positive: string,
  negative: string,
  variation: number
) => `
Transform the supplied family photo into a printable children's coloring-book page.
Use the photo as the identity, pose, clothing, and scene reference. Preserve recognizable visible features while simplifying cleanly; do not copy photographic texture.

ART DIRECTION:
${positive}

AVOID:
${negative}

OUTPUT REQUIREMENTS:
- portrait page, approximately A4 proportions
- pure white background and solid black outlines
- no gray, shading, hatching, gradients, color, text, border, or watermark-like marks
- bold, smooth, closed shapes with large areas that children ages 3-6 can color
- friendly anatomy, uncluttered composition, generous margins
- return only the finished coloring page image

Create variation ${variation} with a slightly different clean composition while retaining the same people and essential scene.`;
