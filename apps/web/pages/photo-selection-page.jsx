import React, { useState, useCallback } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { WizardShell } from "./wizard-shell.jsx";
import { useCreateBookRun } from "../hooks/use-create-book-run.js";
import { useApiClient } from "../api-client.js";
import styles from "./photo-selection-page.module.css";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";
const MIN_PHOTOS = 5;
const MAX_PHOTOS = 20;
const MAX_BYTES = 26_214_400; // 25 MB per photo

/** Compute SHA-256 hex digest for a File. */
async function sha256Hex(file) {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Step 2 of 4 — Photo selection.
 * Receives bookId from search params.
 * On continue: computes SHA-256 per file, calls createBookRun, uploads
 * each file to its returned uploadUrl, then navigates to /books/new/order.
 */
export function PhotoSelectionPage() {
  const { bookId } = useSearch({ strict: false });
  const navigate = useNavigate();
  const api = useApiClient();
  const { mutateAsync: createBookRun } = useCreateBookRun();

  // Each photo: { file: File, preview: string, name: string }
  const [photos, setPhotos] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null); // null | 'uploading' | 'error'
  const [uploadError, setUploadError] = useState(null);

  const hasValidCount =
    photos.length >= MIN_PHOTOS && photos.length <= MAX_PHOTOS;

  const handleFileChange = useCallback(
    e => {
      const selected = Array.from(e.currentTarget.files ?? []);
      const availableSlots = Math.max(0, MAX_PHOTOS - photos.length);
      const toAdd = selected
        .slice(0, availableSlots)
        .filter(f => f.size <= MAX_BYTES);
      const newPhotos = toAdd.map(file => ({
        file,
        preview: URL.createObjectURL(file),
        name: file.name,
      }));
      setPhotos(prev => [...prev, ...newPhotos]);
      e.currentTarget.value = "";
    },
    [photos.length]
  );

  function removePhoto(index) {
    setPhotos(prev => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function handleContinue() {
    if (!hasValidCount || !bookId) return;
    setUploadStatus("uploading");
    setUploadError(null);

    try {
      // 1. Compute SHA-256 for each file
      const hashes = await Promise.all(
        photos.map(({ file }) => sha256Hex(file))
      );

      // 2. Create the run and get upload intents
      const photoInputs = photos.map(({ file }, i) => ({
        contentType: file.type,
        byteSize: file.size,
        sha256: hashes[i],
        ordinal: i + 1,
      }));

      const { runId, uploads } = await createBookRun({
        bookId,
        photos: photoInputs,
      });

      // 3. Upload each file directly to its signed URL
      await Promise.all(
        uploads.map((intent, i) =>
          api.uploadPhoto(
            intent.uploadUrl,
            intent.requiredHeaders,
            photos[i].file
          )
        )
      );

      // 4. Store photo metadata in sessionStorage so OrderPagesPage can show thumbnails
      const photoMeta = photos.map((p, i) => ({
        photoId: uploads[i].photoId,
        name: p.name,
        // Keep preview as object URL — these survive SPA navigation within the same tab.
        // If the page is refreshed, thumbnails will not show (order still works from server data).
        preview: p.preview,
      }));
      try {
        sessionStorage.setItem(
          `pictobook_photos_${runId}`,
          JSON.stringify(photoMeta)
        );
      } catch {
        // sessionStorage may be blocked in private windows — not fatal
      }

      navigate({ to: "/books/new/order", search: { bookId, runId } });
    } catch (err) {
      setUploadStatus("error");
      setUploadError(err.message ?? "Upload failed. Please try again.");
    }
  }

  const isUploading = uploadStatus === "uploading";

  return (
    <WizardShell step={2}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>Choose the moments</span>
        <h1 className={styles.heading}>Pick 5–20 photos.</h1>
        <p className={styles.lead}>
          Choose clear photos of family, pets, and favourite places. Each photo
          becomes one page in the book.
        </p>
      </header>

      <label className={styles.uploadZone} htmlFor="photo-picker">
        <span className={styles.uploadIcon} aria-hidden="true">
          ＋
        </span>
        <strong className={styles.uploadPrimary}>
          Choose photos from your device
        </strong>
        <span className={styles.uploadSecondary}>
          JPEG, PNG, or WEBP · 25 MB max per photo
        </span>
        <input
          id="photo-picker"
          type="file"
          accept={ACCEPTED_TYPES}
          multiple
          hidden
          disabled={photos.length >= MAX_PHOTOS || isUploading}
          onChange={handleFileChange}
        />
      </label>

      {photos.length > 0 && (
        <div className={styles.grid} aria-label="Selected photos">
          {photos.map((photo, index) => (
            <div className={styles.tile} key={`${photo.name}-${index}`}>
              <img
                src={photo.preview}
                alt={`Preview of ${photo.name}`}
                className={styles.tileImg}
              />
              <button
                type="button"
                className={styles.removeBtn}
                aria-label={`Remove ${photo.name}`}
                disabled={isUploading}
                onClick={() => removePhoto(index)}
              >
                ×
              </button>
              <span className={styles.tileName} title={photo.name}>
                {photo.name}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.countLine} aria-live="polite">
        <span>
          <strong>
            {photos.length} photo{photos.length !== 1 ? "s" : ""} selected
          </strong>
          {" · "}at least {MIN_PHOTOS}, up to {MAX_PHOTOS} photos
        </span>
        <span className={styles.privacy}>All photos stay private</span>
      </div>

      {uploadError && (
        <p className={styles.errorMsg} role="alert">
          {uploadError}
        </p>
      )}

      <div className={styles.footer}>
        <span className={styles.footerNote}>
          Remove a photo if it is blurry, too dark, or not part of this story.
        </span>
        <button
          type="button"
          className={styles.ctaBtn}
          disabled={!hasValidCount || isUploading}
          onClick={handleContinue}
        >
          {isUploading ? "Uploading…" : "Arrange pages →"}
        </button>
      </div>
    </WizardShell>
  );
}
