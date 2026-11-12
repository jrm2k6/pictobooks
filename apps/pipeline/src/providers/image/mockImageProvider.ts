import { join } from "node:path";
import type { ImageProvider } from "./ImageProvider.js";
import { ensureDir } from "../../io/files.js";
import { writeMockColoringPagePng } from "../../io/png.js";

export const mockImageProvider: ImageProvider = {
  async generatePage(input) {
    await ensureDir(input.candidateDir);

    const candidateCount = input.request.model.params?.candidate_count ?? 1;
    const candidates = [];

    const startIndex = input.candidateStartIndex ?? 1;
    for (let offset = 0; offset < candidateCount; offset += 1) {
      const index = startIndex + offset;
      const candidateId = `candidate_${String(index).padStart(3, "0")}`;
      const uri = join(input.candidateDir, `${candidateId}.png`);
      await writeMockColoringPagePng(uri, 2480, 3508);
      candidates.push({
        candidate_id: candidateId,
        uri,
        width_px: 2480 as const,
        height_px: 3508 as const,
      });
    }

    return candidates;
  },
};
