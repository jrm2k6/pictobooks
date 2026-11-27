import React, { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useApiClient, UnauthorizedError } from "../api-client.js";
import {
  canContinueReview,
  includedPageSlots,
} from "../hooks/reconcile-page-slots.js";
import { AppShell } from "../app-shell.jsx";
import { useBookPages } from "../hooks/use-book-pages.js";
import { useArtifactAccess } from "../hooks/use-artifact-access.js";
import styles from "./book-preview-page.module.css";

/**
 * The candidate a slot's current page should display. By the time a
 * customer reaches preview, page-review's canContinue was already true,
 * so every slot's current page carries an approvedCandidateId — fall
 * back to the first candidate only for a direct deep link that lands
 * here before that's resolved.
 */
function displayCandidate(page) {
  if (!page?.candidates?.length) return null;
  const candidateId =
    page.approvedCandidateId ?? page.candidates[0]?.candidateId;
  return page.candidates.find(c => c.candidateId === candidateId) ?? null;
}

/** A single-sided print preview, using the included pages in book order. */
export function BookPreviewPage() {
  const { bookId, runId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const api = useApiClient();
  const {
    slots: allSlots,
    printablePdfEnabled,
    isLoading,
    isError,
  } = useBookPages(bookId, runId);
  const download = useMutation({
    mutationFn: async () => {
      const blob = await api.downloadPrintablePdf(bookId, runId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "pictobook.pdf";
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
    onError: error => {
      if (error instanceof UnauthorizedError) navigate({ to: "/sign-in" });
    },
  });
  const slots = includedPageSlots(allSlots);
  const canDownload = !isLoading && !isError && canContinueReview(slots);

  function handleBackToReview() {
    navigate({ to: "/books/new/pages", search: { bookId, runId } });
  }

  function handleChooseEdition() {
    // TODO: edition/checkout routes don't exist yet. This is a
    // placeholder destination until that scope is built, matching how
    // processing-page.jsx's redirect was a placeholder before it had a
    // real review screen to send customers to.
    navigate({ to: "/books" });
  }

  return (
    <AppShell>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Your book, start to finish</span>
        <h1 className={styles.heading}>Take a look through the book.</h1>
        {!isLoading && !isError && (
          <p className={styles.lead}>
            {printablePdfEnabled && slots.length === 0
              ? "Add a page in review to make your printable PDF."
              : printablePdfEnabled && !canDownload
                ? "Approve every included page in review to download your printable PDF."
                : `${slots.length} finished page${slots.length === 1 ? "" : "s"}, ready for printing.`}
          </p>
        )}
      </header>

      {isLoading ? (
        <p className={styles.loading}>Loading your book…</p>
      ) : isError ? (
        <p className={styles.loading} role="alert">
          Something went wrong loading this book. Try reloading the page.
        </p>
      ) : slots.length === 0 ? (
        <p className={styles.loading}>No pages yet</p>
      ) : (
        <BookReader key={`${bookId}/${runId}`} slots={slots} />
      )}

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.secondaryBtn}
          onClick={handleBackToReview}
        >
          Back to page review
        </button>
        {printablePdfEnabled ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={() => download.mutate()}
            disabled={!canDownload || download.isPending}
          >
            {download.isPending
              ? "Preparing your PDF…"
              : download.isError
                ? "Retry PDF download"
                : "Download printable PDF"}
          </button>
        ) : !isLoading && !isError ? (
          <button
            type="button"
            className={styles.primaryBtn}
            onClick={handleChooseEdition}
          >
            Choose an edition <span aria-hidden="true">→</span>
          </button>
        ) : null}
      </div>
      {printablePdfEnabled &&
        download.isError &&
        !(download.error instanceof UnauthorizedError) && (
          <p className={styles.downloadMessage} role="alert">
            {download.error.code === "printable_pdf_not_ready"
              ? "Your book isn’t ready to download. Check that every included page is approved."
              : download.error.code === "printable_pdf_too_large"
                ? "This book is too large to download as a PDF."
                : "We couldn’t download your PDF. Please try again."}
          </p>
        )}
    </AppShell>
  );
}

function useDecodedImage(url) {
  const [decodedUrl, setDecodedUrl] = useState(null);

  useEffect(() => {
    if (!url) return;
    let current = true;
    const image = new Image();
    image.src = url;
    image.decode().then(
      () => {
        if (current) setDecodedUrl(url);
      },
      () => {
        // The page can still show its usual placeholder when an image fails.
      }
    );
    return () => {
      current = false;
    };
  }, [url]);

  return decodedUrl;
}

function usePageAssets(slot) {
  const artwork = useArtifactAccess(
    displayCandidate(slot?.currentPage)?.artifactId ?? null
  ).url;
  const source = useArtifactAccess(slot?.sourceArtifactId).url;
  const decodedArtwork = useDecodedImage(artwork);
  const decodedSource = useDecodedImage(source);
  return { artwork, source, decodedArtwork, decodedSource };
}

function BookReader({ slots }) {
  const [reader, setReader] = useState({
    index: 0,
    turn: null,
    pendingIds: [],
    turnNumber: 0,
  });
  const { turn } = reader;
  const current = Math.min(reader.index, slots.length - 1);
  const previousAssets = usePageAssets(slots[current - 1]);
  const currentAssets = usePageAssets(slots[current]);
  const nextAssets = usePageAssets(slots[current + 1]);
  const queuedAssets = usePageAssets(
    slots.find(slot => slot.originalPageId === reader.pendingIds[0])
  );
  const nearbyAssets = {
    [current - 1]: previousAssets,
    [current]: currentAssets,
    [current + 1]: nextAssets,
  };
  const decodedUrls = new Set(
    [...Object.values(nearbyAssets), queuedAssets].flatMap(assets => [
      assets.decodedArtwork,
      assets.decodedSource,
    ])
  );

  function requestedIndex(state) {
    const ids = [...state.pendingIds].reverse();
    ids.push(state.turn?.targetId);
    for (const id of ids) {
      const index = slots.findIndex(slot => slot.originalPageId === id);
      if (index >= 0) return index;
    }
    return Math.min(state.index, slots.length - 1);
  }

  function move(direction, event) {
    const instant = event.detail === 0 || prefersReducedMotion();

    setReader(state => {
      const target = requestedIndex(state) + direction;
      if (target < 0 || target >= slots.length) return state;
      if (instant) {
        return { ...state, index: target, turn: null, pendingIds: [] };
      }
      if (state.turn && target === Math.min(state.index, slots.length - 1)) {
        return { ...state, index: target, turn: null, pendingIds: [] };
      }
      if (state.turn || state.pendingIds.length > 0) {
        const targetId = slots[target].originalPageId;
        const activeId =
          state.turn?.targetId ??
          slots[Math.min(state.index, slots.length - 1)].originalPageId;
        if (targetId === activeId) return { ...state, pendingIds: [] };

        const queuedIndex = state.pendingIds.indexOf(targetId);
        return {
          ...state,
          pendingIds:
            queuedIndex < 0
              ? [...state.pendingIds, targetId]
              : state.pendingIds.slice(0, queuedIndex + 1),
        };
      }

      return startPageStep(state, target, slots, nearbyAssets, decodedUrls);
    });
  }

  useEffect(() => {
    if (turn || reader.pendingIds.length === 0) return;

    setReader(state => {
      if (state.turn || state.pendingIds.length === 0) return state;
      const [targetId, ...pendingIds] = state.pendingIds;
      const target = slots.findIndex(slot => slot.originalPageId === targetId);
      const remaining = { ...state, pendingIds };
      if (target < 0) return remaining;
      if (prefersReducedMotion()) return { ...remaining, index: target };
      return startPageStep(remaining, target, slots, nearbyAssets, decodedUrls);
    });
  }, [turn, reader.pendingIds, slots, nearbyAssets, decodedUrls]);

  function finishTurn(event) {
    if (event.currentTarget !== event.target) return;
    setReader(state => {
      if (state.turn !== turn) return state;
      const target = slots.findIndex(
        slot => slot.originalPageId === turn.targetId
      );
      return { ...state, index: target < 0 ? state.index : target, turn: null };
    });
  }

  const targetIndex = turn
    ? slots.findIndex(slot => slot.originalPageId === turn.targetId)
    : -1;
  const forward = turn?.direction === 1;
  const backward = turn?.direction === -1;
  const referenceImage = backward
    ? turn.to.source
    : (turn?.from ?? currentAssets).source;
  const referencePage =
    backward && targetIndex >= 0 ? targetIndex + 1 : current + 1;
  const leafReference = forward ? turn.to.source : turn?.from.source;
  const artBeneathLeaf = forward
    ? turn.to.artwork
    : (turn?.from ?? currentAssets).artwork;
  const leafArt = forward ? turn.from.artwork : turn?.to.artwork;
  const requested = requestedIndex(reader);
  const previousDisabled = requested === 0;
  const nextDisabled = requested === slots.length - 1;

  return (
    <>
      <div className={styles.spread}>
        <div className={`${styles.sheet} ${styles.leftSheet}`}>
          <ReferencePhoto
            url={referenceImage}
            alt={`Original uploaded photo for page ${referencePage}`}
          />
        </div>
        <div className={`${styles.sheet} ${styles.rightSheet}`}>
          <PageArt
            url={artBeneathLeaf}
            alt={`Coloring artwork for page ${current + (forward ? 2 : 1)}`}
          />
        </div>
        {turn && (
          <div
            key={reader.turnNumber}
            className={`${styles.leaf} ${forward ? styles.leafForward : styles.leafBackward}`}
            onAnimationEnd={finishTurn}
            aria-hidden="true"
          >
            <div
              className={`${styles.sheet} ${styles.rightSheet} ${styles.leafFace}`}
            >
              <PageArt url={leafArt} alt="" />
            </div>
            <div
              className={`${styles.sheet} ${styles.leftSheet} ${styles.leafFace} ${styles.leafBack}`}
            >
              <ReferencePhoto url={leafReference} alt="" />
            </div>
          </div>
        )}
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={event => move(-1, event)}
          aria-disabled={previousDisabled}
        >
          ← Previous page
        </button>
        <span className={styles.pageCount} role="status">
          Page {current + 1} of {slots.length}
        </span>
        <button
          type="button"
          className={styles.ghostBtn}
          onClick={event => move(1, event)}
          aria-disabled={nextDisabled}
        >
          Next page →
        </button>
      </div>
    </>
  );
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function startPageStep(state, target, slots, nearbyAssets, decodedUrls) {
  const index = Math.min(state.index, slots.length - 1);
  const from = nearbyAssets[index];
  const to = nearbyAssets[target];
  const ready = assets =>
    assets?.artwork &&
    assets.source &&
    decodedUrls.has(assets.artwork) &&
    decodedUrls.has(assets.source);

  if (Math.abs(target - index) !== 1 || !ready(from) || !ready(to)) {
    return { ...state, index: target, turn: null };
  }

  return {
    ...state,
    index,
    turnNumber: state.turnNumber + 1,
    turn: {
      direction: target - index,
      targetId: slots[target].originalPageId,
      from,
      to,
    },
  };
}

function ReferencePhoto({ url, alt }) {
  return (
    <>
      <PageArt url={url} alt={alt} />
      <span className={styles.referenceLabel}>Original photo · reference</span>
    </>
  );
}

function PageArt({ url, alt }) {
  return url ? (
    <img src={url} alt={alt} className={styles.pageImage} />
  ) : (
    <div className={styles.pagePlaceholder} aria-hidden="true" />
  );
}
