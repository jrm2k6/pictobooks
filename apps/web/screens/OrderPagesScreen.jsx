import React from "react";

function StepHeader() {
  return (
    <div className="step-head">
      <span className="step-label"><strong>Step 3 of 4</strong> · Create your book</span>
      <span className="step-track" aria-label="Step 3 of 4">
        <i className="on" /><i className="on" /><i className="on" /><i />
      </span>
    </div>
  );
}

export default function OrderPagesScreen({ photos, draft, onReorderPhotos, onNavigate }) {
  const pageCount = photos.length;

  return (
    <div className="form-shell">
      <StepHeader />
      <div className="app-eyebrow">Before we start</div>
      <h1>Put the moments in order.</h1>
      <p className="lead">
        Choose the sequence for <strong>{draft.title || "your book"}</strong>. Use the arrows to move a moment; you can still replace pages later.
      </p>

      <div className="photo-order-list" role="list" aria-label="Book page order">
        {photos.map((photo, index) => (
          <div className="order-photo" role="listitem" key={photo.id || `${photo.name}-${index}`}>
            <span className="order-number" aria-label={`Page ${index + 1}`}>
              {String(index + 1).padStart(2, "0")}
            </span>
            <img src={photo.preview} alt="" />
            <span>
              <strong>{photo.name || `Photo ${index + 1}`}</strong>
              <small>Page {String(index + 1).padStart(2, "0")}</small>
            </span>
            <span className="order-actions">
              <button
                type="button"
                aria-label={`Move ${photo.name || `page ${index + 1}`} up`}
                disabled={index === 0}
                onClick={() => onReorderPhotos(index, index - 1)}
              >↑</button>
              <button
                type="button"
                aria-label={`Move ${photo.name || `page ${index + 1}`} down`}
                disabled={index === pageCount - 1}
                onClick={() => onReorderPhotos(index, index + 1)}
              >↓</button>
            </span>
          </div>
        ))}
      </div>

      <div className="info-callout">
        <span className="check" aria-hidden="true">i</span>
        <span>Your book will have <strong>{pageCount} {pageCount === 1 ? "page" : "pages"} plus a personalized cover.</strong> You can review each one before ordering.</span>
      </div>

      <div className="form-footer">
        <small>Generation usually takes a few minutes. We’ll let you know when it’s ready.</small>
        <button className="button primary" type="button" onClick={() => onNavigate("processing")}>
          Make the pages <span className="arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
