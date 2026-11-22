export function reconcilePageSlots({ primaryRun, otherRuns }) {
  const liveRuns = otherRuns.filter(run => !run.uploadExpired);

  const byTarget = new Map();
  for (const run of liveRuns) {
    const page = run.pages[0];
    if (!page?.replacesPageId) continue;
    const list = byTarget.get(page.replacesPageId) ?? [];
    list.push({ run, page });
    byTarget.set(page.replacesPageId, list);
  }

  const resolve = pageId => {
    const candidates = byTarget.get(pageId);
    if (!candidates?.length) return null;
    return candidates.reduce((latest, candidate) =>
      new Date(candidate.run.createdAt) > new Date(latest.run.createdAt)
        ? candidate
        : latest
    );
  };

  const slots = primaryRun.pages.map(originalPage => {
    let current = { run: primaryRun, page: originalPage };
    for (
      let next = resolve(current.page.pageId);
      next;
      next = resolve(current.page.pageId)
    ) {
      current = next;
    }
    // Looked up from whichever run/page the slot *currently* resolves to,
    // not the original primary page — a photo replacement's new photo has
    // a genuinely different sourceArtifactId than what it replaced.
    const sourceArtifactId =
      current.run.photos?.find(p => p.photoId === current.page.photoId)
        ?.sourceArtifactId ?? null;
    return {
      originalPageId: originalPage.pageId,
      currentRunId: current.run.runId,
      currentPageId: current.page.pageId,
      currentPage: current.page,
      sourceArtifactId,
    };
  });

  return {
    slots,
    regenerationsUsed: liveRuns.filter(
      r => r.regenerationKind === "candidate_regeneration"
    ).length,
    replacementsUsed: liveRuns.filter(
      r => r.regenerationKind === "photo_replacement"
    ).length,
  };
}

export function canContinueReview(slots) {
  return (
    slots.length > 0 &&
    slots.every(slot => slot.currentPage.state === "approved")
  );
}
