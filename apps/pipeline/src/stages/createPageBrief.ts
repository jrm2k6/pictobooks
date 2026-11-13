import type {
  PageBrief,
  PhotoAnalysis,
  SubjectBrief,
} from "../contracts/types.js";
import { STYLE_PACK_VERSION } from "../style/pictobookPreschoolV01.js";

const subjectToBrief = (
  subject: NonNullable<PhotoAnalysis["subjects"]>[number]
) => {
  const cueParts = [
    subject.description,
    subject.action ? subject.action : undefined,
  ].filter(Boolean);

  const brief: SubjectBrief = {
    local_id: subject.local_id,
    type: subject.type,
    centrality: subject.centrality,
    source_bounding_box: subject.bounding_box,
    prompt_text: cueParts.join(", "),
  };

  if (subject.type === "person" && subject.centrality === "primary") {
    brief.role = "main child";
  }

  return brief;
};

export const createPageBrief = (analysis: PhotoAnalysis): PageBrief => {
  if (analysis.status !== "accepted") {
    throw new Error(`Cannot create PageBrief for ${analysis.status} photo`);
  }

  const pageId = analysis.photo_id.replace(/^photo_/, "page_");
  const subjects = analysis.subjects ?? [];
  const subjectBriefs = subjects
    .filter(subject => subject.centrality !== "incidental")
    .map(subjectToBrief);

  const subjectSentence = subjectBriefs
    .map(subject => subject.prompt_text)
    .join(". ");
  const keepSentence = (analysis.keep ?? []).join(", ");
  const removeSentence = (analysis.remove ?? []).join(", ");

  return {
    schema_version: "2026-09-16",
    page_id: pageId,
    photo_id: analysis.photo_id,
    source_uri: analysis.source_uri,
    style_pack_version: STYLE_PACK_VERSION,
    scene_summary: analysis.scene_summary ?? "simple family photo scene",
    subject_briefs: subjectBriefs,
    keep: analysis.keep ?? [],
    remove: analysis.remove ?? [],
    composition_freedom: "reinterpret_cleanly",
    final_art_constraints: {
      format: "png",
      page_size: "A4",
      orientation: "portrait",
      width_px: 2480,
      height_px: 3508,
      color_mode: "black_and_white",
      background: "white",
      allow_grayscale: false,
      allow_text: false,
      complexity: "simple",
    },
    final_brief: [
      `Create a simple coloring-book page showing ${analysis.scene_summary}.`,
      subjectSentence ? `Subjects: ${subjectSentence}.` : undefined,
      keepSentence ? `Keep: ${keepSentence}.` : undefined,
      removeSentence ? `Remove: ${removeSentence}.` : undefined,
      "Reinterpret the photo cleanly with sparse background and large closed shapes.",
    ]
      .filter(Boolean)
      .join(" "),
    metadata_caption: analysis.scene_summary ?? "Generated coloring page",
  };
};
