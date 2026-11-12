import React from "react";

export default function PhotoUploadErrorScreen({ onNavigate }) {
  return (
    <section className="error-panel" role="alert" aria-labelledby="photo-upload-error-title">
      <span className="pill gold"><span className="dot" aria-hidden="true" />Photo upload paused</span>
      <h1 id="photo-upload-error-title">One photo did not upload.</h1>
      <p>
        Pippin-at-the-park.jpg is larger than the 25 MB limit. Your other four
        photos are safe. Choose a smaller version or remove the failed photo to
        continue.
      </p>
      <div className="error-detail">Pippin-at-the-park.jpg · 28.4 MB · limit 25 MB</div>
      <button
        className="button primary"
        type="button"
        onClick={() => onNavigate("upload", "Try another photo")}
      >Choose another photo</button>{" "}
      <button
        className="button ghost"
        type="button"
        onClick={() => onNavigate("library", "Leave creation")}
      >Return to My books</button>
    </section>
  );
}
