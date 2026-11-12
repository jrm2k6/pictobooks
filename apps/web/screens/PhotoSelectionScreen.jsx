import React from "react";

const acceptedTypes = "image/jpeg,image/png,image/heic,image/heif";

function StepHeader() {
  return (
    <div className="step-head">
      <span className="step-label"><strong>Step 2 of 4</strong> · Create your book</span>
      <span className="step-track" aria-label="Step 2 of 4">
        <i className="on" /><i className="on" /><i /><i />
      </span>
    </div>
  );
}

export default function PhotoSelectionScreen({ photos, onAddFiles, onRemovePhoto, onNavigate }) {
  const hasValidPhotoCount = photos.length >= 5 && photos.length <= 10;

  const handleFileChange = (event) => {
    const selected = Array.from(event.currentTarget.files || []);
    const availableSlots = Math.max(0, 10 - photos.length);
    if (selected.length > 0 && availableSlots > 0) {
      onAddFiles(selected.slice(0, availableSlots));
    }
    event.currentTarget.value = "";
  };

  return (
    <div className="form-shell">
      <StepHeader />
      <div className="app-eyebrow">Choose the moments</div>
      <h1>Pick 5–10 photos.</h1>
      <p className="lead">
        Choose clear photos of family, pets, and favorite places. Each photo can become one page in the book.
      </p>

      <label className="upload-zone" htmlFor="photo-picker">
        <span className="upload-icon" aria-hidden="true">＋</span>
        <strong>Choose photos from your device</strong>
        <span>JPEG, PNG, or HEIC · 25 MB max per photo</span>
        <input
          id="photo-picker"
          type="file"
          accept={acceptedTypes}
          multiple
          hidden
          onChange={handleFileChange}
        />
      </label>

      <div className="photo-grid" aria-label="Selected photos">
        {photos.map((photo, index) => (
          <div className="photo-tile" key={`${photo.name}-${index}`}>
            <img src={photo.preview} alt={photo.name ? `Preview of ${photo.name}` : "Selected photo preview"} />
            <button
              type="button"
              aria-label={`Remove ${photo.name || `photo ${index + 1}`}`}
              onClick={() => onRemovePhoto(index)}
            >×</button>
            <span title={photo.name}>{photo.name}</span>
          </div>
        ))}
      </div>

      <div className="upload-footer" aria-live="polite">
        <span><strong>{photos.length} photos selected</strong> · at least 5, up to 10</span>
        <span>All photos stay private</span>
      </div>

      <div className="form-footer">
        <small>Remove a photo if it is blurry, too dark, or not part of this story.</small>
        <button
          className="button primary"
          type="button"
          disabled={!hasValidPhotoCount}
          onClick={() => onNavigate("arrange")}
        >Arrange pages <span className="arrow" aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}
