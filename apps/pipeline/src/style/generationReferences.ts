import type { CanonicalReference } from "./styleJudge.js";

export const selectGenerationStyleReferences = (
  references: CanonicalReference[],
  limit = 3
) => {
  if (limit <= 0 || references.length === 0) return [];
  if (references.length <= limit) return [...references];
  if (limit === 1) return [references.at(-1)!];

  const indexes = Array.from({ length: limit }, (_, index) =>
    Math.round((index * (references.length - 1)) / (limit - 1))
  );
  return indexes.map(index => references[index]);
};
