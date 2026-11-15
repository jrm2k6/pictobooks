import React, { useState, useEffect } from 'react';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { WizardShell } from './wizard-shell.jsx';
import { useApiClient } from '../api-client.js';
import styles from './order-pages-page.module.css';

/**
 * Step 3 of 4 — Order the pages.
 * Receives bookId and runId from search params.
 * Loads photo metadata from sessionStorage (set by PhotoSelectionPage).
 * On confirm: calls updatePhotoOrder then startBookRun, navigates to creating.
 */
export function OrderPagesPage() {
  const { bookId, runId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const api = useApiClient();
  const queryClient = useQueryClient();

  // Load photo metadata stored by PhotoSelectionPage
  const [photos, setPhotos] = useState(() => {
    try {
      const raw = sessionStorage.getItem(`pictobook_photos_${runId}`);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  // Re-load if runId changes (e.g. if sessionStorage wasn't set yet on first render)
  useEffect(() => {
    if (runId && photos.length === 0) {
      try {
        const raw = sessionStorage.getItem(`pictobook_photos_${runId}`);
        if (raw) setPhotos(JSON.parse(raw));
      } catch {
        // ignore
      }
    }
  }, [runId]);

  const { mutateAsync: startRun, isPending, error } = useMutation({
    mutationFn: async () => {
      const photoIds = photos.map((p) => p.photoId);
      await api.updatePhotoOrder(bookId, runId, photoIds);
      await api.startBookRun(bookId, runId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['books'] });
      queryClient.invalidateQueries({ queryKey: ['book-run', bookId, runId] });
      // Clear photo metadata from sessionStorage now that run is started
      try {
        sessionStorage.removeItem(`pictobook_photos_${runId}`);
      } catch {
        // ignore
      }
    },
  });

  function movePhoto(fromIndex, toIndex) {
    if (toIndex < 0 || toIndex >= photos.length) return;
    setPhotos((prev) => {
      const updated = [...prev];
      const [removed] = updated.splice(fromIndex, 1);
      updated.splice(toIndex, 0, removed);
      return updated;
    });
  }

  async function handleMakePages() {
    await startRun();
    navigate({ to: '/books/new/creating', search: { bookId, runId } });
  }

  return (
    <WizardShell step={3}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Before we start</span>
        <h1 className={styles.heading}>Put the moments in order.</h1>
        <p className={styles.lead}>
          Choose the sequence for your book. Use the arrows to move a moment;
          you can still rearrange pages later.
        </p>
      </header>

      {photos.length > 0 ? (
        <ol className={styles.list} aria-label="Book page order">
          {photos.map((photo, index) => (
            <li key={photo.photoId} className={styles.item}>
              <span className={styles.pageNum} aria-label={`Page ${index + 1}`}>
                {String(index + 1).padStart(2, '0')}
              </span>
              {photo.preview ? (
                <img
                  src={photo.preview}
                  alt=""
                  className={styles.thumb}
                />
              ) : (
                <div className={styles.thumbPlaceholder} aria-hidden="true" />
              )}
              <span className={styles.photoName}>
                <strong>{photo.name ?? `Photo ${index + 1}`}</strong>
                <small>Page {String(index + 1).padStart(2, '0')}</small>
              </span>
              <span className={styles.actions}>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  aria-label={`Move ${photo.name ?? `page ${index + 1}`} up`}
                  disabled={index === 0 || isPending}
                  onClick={() => movePhoto(index, index - 1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.arrowBtn}
                  aria-label={`Move ${photo.name ?? `page ${index + 1}`} down`}
                  disabled={index === photos.length - 1 || isPending}
                  onClick={() => movePhoto(index, index + 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className={styles.noPhotos}>
          Photo order could not be loaded. Try going back and re-selecting your photos.
        </p>
      )}

      <div className={styles.callout} role="note">
        <span className={styles.calloutIcon} aria-hidden="true">i</span>
        <span>
          Your book will have{' '}
          <strong>
            {photos.length} {photos.length === 1 ? 'page' : 'pages'} plus a
            personalised cover.
          </strong>{' '}
          You can review each one before ordering.
        </span>
      </div>

      {error && (
        <p className={styles.errorMsg} role="alert">
          {error.message ?? 'Something went wrong. Please try again.'}
        </p>
      )}

      <div className={styles.footer}>
        <span className={styles.footerNote}>
          Generation usually takes a few minutes. We'll let you know when it's ready.
        </span>
        <button
          type="button"
          className={styles.ctaBtn}
          disabled={photos.length === 0 || isPending}
          onClick={handleMakePages}
        >
          {isPending ? 'Starting…' : 'Make the pages →'}
        </button>
      </div>
    </WizardShell>
  );
}
