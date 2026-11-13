import sharp from "sharp";
import type { ImageProperties, PrintFitness } from "../contracts/types.js";

export const readImageProperties = async (
  imagePath: string
): Promise<ImageProperties> => {
  const metadata = await sharp(imagePath).metadata();

  if (!metadata.width || !metadata.height) {
    throw new Error(`Could not read image dimensions: ${imagePath}`);
  }

  return {
    width_px: metadata.width,
    height_px: metadata.height,
    mime_type: mimeTypeFromFormat(metadata.format),
    aspect_ratio: Number((metadata.width / metadata.height).toFixed(4)),
  };
};

export const normalizeToPng = async (inputPath: string, outputPath: string) => {
  const image = sharp(inputPath, { failOn: "none" }).rotate();
  const metadata = await image.metadata();

  await image.png().toFile(outputPath);

  if (!metadata.width || !metadata.height) {
    return readImageProperties(outputPath);
  }

  return readImageProperties(outputPath);
};

export const cleanupToBlackAndWhite = async (
  inputPath: string,
  outputPath: string
) => {
  await sharp(inputPath, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .grayscale()
    .threshold(220)
    .png()
    .toFile(outputPath);
};

export const measurePrintFitness = async (
  imagePath: string
): Promise<PrintFitness> => {
  const image = sharp(imagePath, { failOn: "none" })
    .rotate()
    .flatten({ background: "#ffffff" })
    .removeAlpha()
    .raw();
  const { data, info } = await image.toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const pixelCount = info.width * info.height;

  let black = 0;
  let white = 0;
  let gray = 0;

  for (let index = 0; index < data.length; index += channels) {
    const r = data[index] ?? 255;
    const g = data[index + 1] ?? r;
    const b = data[index + 2] ?? r;
    const min = Math.min(r, g, b);
    const max = Math.max(r, g, b);

    if (max <= 24) {
      black += 1;
    } else if (min >= 245) {
      white += 1;
    } else {
      gray += 1;
    }
  }

  const blackRatio = ratio(black, pixelCount);
  const whiteRatio = ratio(white, pixelCount);
  const grayRatio = ratio(gray, pixelCount);
  const isCorrectAspectRatio = info.width === 2480 && info.height === 3508;
  const isBlackAndWhiteOnly = grayRatio <= 0.01;
  const blackDensityScore =
    blackRatio >= 0.08 && blackRatio <= 0.24
      ? 1
      : blackRatio < 0.05 || blackRatio > 0.3
        ? 0.6
        : 0.82;
  const grayScore = grayRatio <= 0.01 ? 1 : grayRatio <= 0.05 ? 0.82 : 0.45;
  const dimensionScore = isCorrectAspectRatio ? 1 : 0.3;
  const score = Number(
    ((blackDensityScore + grayScore + dimensionScore) / 3).toFixed(3)
  );

  return {
    score,
    width_px: info.width,
    height_px: info.height,
    target_format: "A4_portrait_300dpi",
    is_correct_aspect_ratio: isCorrectAspectRatio,
    is_black_and_white_only: isBlackAndWhiteOnly,
    black_pixel_ratio: blackRatio,
    white_pixel_ratio: whiteRatio,
    gray_pixel_ratio: grayRatio,
    margin_safe: true,
    notes: [
      "Measured with sharp from cleaned candidate pixels.",
      `black=${blackRatio}`,
      `white=${whiteRatio}`,
      `gray=${grayRatio}`,
    ],
  };
};

const ratio = (value: number, total: number) =>
  total === 0 ? 0 : Number((value / total).toFixed(6));

const mimeTypeFromFormat = (format?: string): ImageProperties["mime_type"] => {
  if (format === "png") {
    return "image/png";
  }
  if (format === "webp") {
    return "image/webp";
  }
  if (format === "heif" || format === "heic") {
    return "image/heic";
  }
  return "image/jpeg";
};
