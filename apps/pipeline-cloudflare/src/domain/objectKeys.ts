const segment = (name: string, value: string): string => {
  if (!/^[a-z0-9][a-z0-9_.-]{0,99}$/.test(value) || value.includes("..")) {
    throw new Error(`${name} is not a safe object-key segment`);
  }
  return value;
};

type PageKeyInput = {
  bookId: string;
  runId: string;
  pageId: string;
};

const pagePrefix = ({ bookId, runId, pageId }: PageKeyInput): string =>
  `books/${segment("bookId", bookId)}/runs/${segment("runId", runId)}/pages/${segment("pageId", pageId)}`;

export const objectKeys = {
  sourcePhoto(input: {
    bookId: string;
    runId: string;
    photoId: string;
    revision: string;
  }): string {
    return `books/${segment("bookId", input.bookId)}/runs/${segment("runId", input.runId)}/photos/${segment("photoId", input.photoId)}/source/${segment("revision", input.revision)}`;
  },

  normalizedPhoto(input: {
    bookId: string;
    runId: string;
    photoId: string;
    revision: string;
  }): string {
    return `books/${segment("bookId", input.bookId)}/runs/${segment("runId", input.runId)}/photos/${segment("photoId", input.photoId)}/normalized/${segment("revision", input.revision)}.jpg`;
  },

  pageBrief(input: PageKeyInput & { revision: string }): string {
    return `${pagePrefix(input)}/briefs/${segment("revision", input.revision)}.json`;
  },

  candidate(
    input: PageKeyInput & {
      candidateId: string;
      variant: "raw" | "clean";
      format?: "png" | "jpg" | "webp" | "svg";
    }
  ): string {
    return `${pagePrefix(input)}/candidates/${segment("candidateId", input.candidateId)}/${input.variant}.${input.format ?? "png"}`;
  },

  candidateQa(
    input: PageKeyInput & {
      candidateId: string;
      kind: "print" | "style";
    }
  ): string {
    return `${pagePrefix(input)}/candidates/${segment("candidateId", input.candidateId)}/${input.kind}-qa.json`;
  },

  bookExport(input: {
    bookId: string;
    runId: string;
    revision: string;
  }): string {
    return `books/${segment("bookId", input.bookId)}/runs/${segment("runId", input.runId)}/exports/${segment("revision", input.revision)}/book.pdf`;
  },

  styleBible(stylePackVersion: string): string {
    return `style-packs/${segment("stylePackVersion", stylePackVersion)}/style-bible.md`;
  },

  canonicalReference(input: {
    stylePackVersion: string;
    canonicalReferenceId: string;
  }): string {
    return `style-packs/${segment("stylePackVersion", input.stylePackVersion)}/canonical/${segment("canonicalReferenceId", input.canonicalReferenceId)}.png`;
  },
} as const;
