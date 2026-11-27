import {
  PDFDocument,
  pushGraphicsState,
  popGraphicsState,
  concatTransformationMatrix,
  drawObject,
  PageSizes,
  LineCapStyle,
  rgb,
  type PDFPage,
} from "pdf-lib";
import { sha256Hex } from "./auth.js";
import { mockCandidateSvg, mockPageDrawing } from "../wp5/mockPageDrawing.js";

const MAX_PAGES = 24;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_PIXELS = 12_000_000;
const PRINT_MARGIN_PT = 36;

type PageRow = {
  run_id: string;
  page_id: string | null;
  included: number | null;
  source_page_id: string | null;
  source_run_id: string | null;
  upload_expired: number;
  state: string | null;
  approval_source: string | null;
  candidate_id: string | null;
  object_key: string | null;
  byte_size: number | null;
  mime_type: string | null;
  sha256: string | null;
};

export class PrintablePdfError extends Error {
  constructor(
    readonly status: number,
    readonly code: string
  ) {
    super(code);
  }
}

export async function createPrintablePdf(
  database: D1Database,
  bucket: R2Bucket,
  userId: string,
  bookId: string,
  runId: string,
  now: string,
  allowMockSvg: boolean
): Promise<Uint8Array> {
  // Resolve membership, ordering, current slot lineage, and candidate
  // artifacts from one read snapshot. The run order matches listBookRuns.
  const { results } = await database
    .prepare(
      `WITH owned_primary AS (
         SELECT r.run_id, r.book_id
         FROM book_runs r
         JOIN books b ON b.book_id = r.book_id
         WHERE b.owner_id = ?1 AND r.book_id = ?2 AND r.run_id = ?3
         AND NOT EXISTS (
           SELECT 1 FROM book_run_regenerations l WHERE l.new_run_id = r.run_id
         )
       ), eligible_runs AS (
         SELECT r.run_id, r.created_at, r.rowid AS run_order,
                l.source_page_id, l.source_run_id,
                EXISTS (
                  SELECT 1 FROM upload_intents ui JOIN photos up ON up.photo_id = ui.photo_id
                  WHERE ui.run_id = r.run_id AND up.source_artifact_id IS NULL AND ui.expires_at <= ?4
                ) AS upload_expired
         FROM book_runs r
         LEFT JOIN book_run_regenerations l ON l.new_run_id = r.run_id
         WHERE r.book_id = (SELECT book_id FROM owned_primary)
         AND (r.run_id = ?3 OR l.new_run_id IS NOT NULL)
       )
       SELECT r.run_id, p.page_id, p.included, r.source_page_id, r.source_run_id, r.upload_expired,
         p.state, p.approval_source, c.candidate_id,
         a.object_key, a.byte_size, a.mime_type, a.sha256
       FROM eligible_runs r
       LEFT JOIN pages p ON p.run_id = r.run_id
       LEFT JOIN photos ph ON ph.photo_id = p.photo_id AND ph.run_id = r.run_id
       LEFT JOIN candidates c ON c.candidate_id = p.approved_candidate_id AND c.page_id = p.page_id
       LEFT JOIN artifacts a ON a.artifact_id = c.clean_artifact_id
         AND a.run_id = r.run_id AND a.page_id = p.page_id
         AND a.artifact_kind = 'candidate_clean' AND a.deleted_at IS NULL
       WHERE r.run_id = ?3 OR NOT r.upload_expired
       ORDER BY r.created_at DESC, r.run_order ASC, ph.ordinal ASC`
    )
    .bind(userId, bookId, runId, now)
    .all<PageRow>();

  const rootRows = results.filter(row => row.run_id === runId);
  if (!rootRows.length) throw new PrintablePdfError(404, "run_not_found");
  const primary = rootRows.filter(row => row.included === 1);
  if (
    !primary.length ||
    primary.length > MAX_PAGES ||
    primary.some(row => !row.page_id || row.upload_expired)
  ) {
    throw new PrintablePdfError(409, "printable_pdf_not_ready");
  }

  const latestByTarget = new Map<string, PageRow>();
  for (const row of results) {
    if (
      row.page_id &&
      row.source_page_id &&
      !latestByTarget.has(row.source_page_id)
    ) {
      latestByTarget.set(row.source_page_id, row);
    }
  }
  const pages = primary.map(original => {
    const visited = new Set<string>();
    let current = original;
    while (current.page_id) {
      const next = latestByTarget.get(current.page_id);
      if (!next) break;
      if (
        next.source_run_id !== current.run_id ||
        visited.has(current.page_id)
      ) {
        throw new PrintablePdfError(409, "printable_pdf_not_ready");
      }
      visited.add(current.page_id);
      current = next;
    }
    return current;
  });
  let totalBytes = 0;
  const artifacts = pages.map(page => {
    if (
      page.state !== "approved" ||
      page.approval_source !== "human" ||
      !page.object_key ||
      !page.sha256 ||
      !page.candidate_id ||
      !page.byte_size ||
      (page.mime_type !== "image/png" &&
        !(allowMockSvg && page.mime_type === "image/svg+xml"))
    ) {
      throw new PrintablePdfError(409, "printable_pdf_not_ready");
    }
    totalBytes += page.byte_size;
    return {
      key: page.object_key,
      size: page.byte_size,
      checksum: page.sha256,
      mimeType: page.mime_type,
      candidateId: page.candidate_id,
    };
  });
  if (totalBytes > MAX_BYTES) {
    throw new PrintablePdfError(409, "printable_pdf_too_large");
  }

  const pdf = await PDFDocument.create({ updateMetadata: false });
  for (const artifact of artifacts) {
    const object = await bucket.get(artifact.key);
    if (!object || object.size !== artifact.size) {
      await object?.body.cancel();
      throw new PrintablePdfError(409, "printable_pdf_not_ready");
    }
    const bytes = new Uint8Array(await object.arrayBuffer());
    if ((await sha256Hex(bytes)) !== artifact.checksum) {
      throw new PrintablePdfError(409, "printable_pdf_not_ready");
    }

    const page = pdf.addPage(PageSizes.Letter);
    if (artifact.mimeType === "image/png") {
      drawPng(page, bytes);
    } else {
      const semanticAttempt = Number(artifact.candidateId.split("-").at(-2));
      if (
        new TextDecoder().decode(bytes) !==
        mockCandidateSvg(artifact.candidateId, semanticAttempt)
      ) {
        throw new PrintablePdfError(409, "printable_pdf_not_ready");
      }
      drawMockPage(page);
    }
  }
  return pdf.save();
}

function fitOnLetter(page: PDFPage, imageWidth: number, imageHeight: number) {
  const scale = Math.min(
    (page.getWidth() - 2 * PRINT_MARGIN_PT) / imageWidth,
    (page.getHeight() - 2 * PRINT_MARGIN_PT) / imageHeight
  );
  const width = imageWidth * scale;
  const height = imageHeight * scale;
  return {
    x: (page.getWidth() - width) / 2,
    y: (page.getHeight() - height) / 2,
    width,
    height,
    scale,
  };
}

// Clean pages from Sharp are non-interlaced PNGs. PDF uses the same
// deflate and row filters, so we can embed IDAT without expanding pixels.
function drawPng(page: PDFPage, bytes: Uint8Array) {
  const invalidImage = () =>
    new PrintablePdfError(409, "printable_pdf_not_ready");
  const header = [137, 80, 78, 71, 13, 10, 26, 10];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (
    bytes.length < 45 ||
    !header.every((byte, index) => byte === bytes[index]) ||
    view.getUint32(8) !== 13 ||
    view.getUint32(12) !== 0x49484452
  ) {
    throw invalidImage();
  }

  const width = view.getUint32(16);
  const height = view.getUint32(20);
  const colors = bytes[25] === 0 ? 1 : bytes[25] === 2 ? 3 : 0;
  if (
    !width ||
    !height ||
    width * height > MAX_PIXELS ||
    !colors ||
    bytes[24] !== 8 ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  ) {
    throw invalidImage();
  }

  const chunks: Uint8Array[] = [];
  let dataSize = 0;
  let foundEnd = false;
  for (let offset = 33; offset + 12 <= bytes.length; ) {
    const size = view.getUint32(offset);
    const type = view.getUint32(offset + 4);
    const next = offset + 12 + size;
    if (next > bytes.length) throw invalidImage();
    if (type === 0x49444154) {
      chunks.push(bytes.subarray(offset + 8, next - 4));
      dataSize += size;
    }
    if (type === 0x49454e44) {
      foundEnd = size === 0 && next === bytes.length;
      break;
    }
    offset = next;
  }
  if (!foundEnd || !dataSize) throw invalidImage();

  const compressed = new Uint8Array(dataSize);
  let dataOffset = 0;
  for (const chunk of chunks) {
    compressed.set(chunk, dataOffset);
    dataOffset += chunk.length;
  }

  const context = page.doc.context;
  const ref = context.register(
    context.stream(compressed, {
      Type: "XObject",
      Subtype: "Image",
      Width: width,
      Height: height,
      BitsPerComponent: 8,
      ColorSpace: colors === 1 ? "DeviceGray" : "DeviceRGB",
      Filter: "FlateDecode",
      DecodeParms: {
        Predictor: 15,
        Columns: width,
        Colors: colors,
        BitsPerComponent: 8,
      },
    })
  );
  const name = page.node.newXObject("Image", ref);
  const fit = fitOnLetter(page, width, height);
  page.pushOperators(
    pushGraphicsState(),
    concatTransformationMatrix(fit.width, 0, 0, fit.height, fit.x, fit.y),
    drawObject(name),
    popGraphicsState()
  );
}

function drawMockPage(page: PDFPage) {
  const { width, height, frame, paths, circles } = mockPageDrawing;
  const fit = fitOnLetter(page, width, height);
  const black = rgb(0, 0, 0);
  const white = rgb(1, 1, 1);
  const { x, y, width: w, height: h, radius: r, stroke } = frame;
  const right = x + w;
  const bottom = y + h;
  page.drawSvgPath(
    `M${x + r} ${y} H${right - r} Q${right} ${y} ${right} ${y + r}
     V${bottom - r} Q${right} ${bottom} ${right - r} ${bottom}
     H${x + r} Q${x} ${bottom} ${x} ${bottom - r}
     V${y + r} Q${x} ${y} ${x + r} ${y} Z`,
    {
      x: fit.x,
      y: fit.y + fit.height,
      scale: fit.scale,
      borderColor: black,
      borderWidth: stroke,
    }
  );
  for (const circle of circles) {
    page.drawCircle({
      x: fit.x + circle.x * fit.scale,
      y: fit.y + (height - circle.y) * fit.scale,
      size: circle.radius * fit.scale,
      color: circle.stroke ? white : black,
      borderColor: black,
      borderWidth: circle.stroke * fit.scale,
    });
  }
  for (const path of paths) {
    page.drawSvgPath(path.d, {
      x: fit.x,
      y: fit.y + fit.height,
      scale: fit.scale,
      borderColor: black,
      borderWidth: path.stroke,
      borderLineCap: path.round ? LineCapStyle.Round : LineCapStyle.Butt,
    });
  }
}
