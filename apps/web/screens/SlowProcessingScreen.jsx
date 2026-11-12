import React from "react";

function StepHeader() {
  return (
    <div className="step-head">
      <span className="step-label"><strong>Step 4 of 4</strong> · Create your book</span>
      <span className="step-track" aria-label="Step 4 of 4">
        <i className="on" /><i className="on" /><i className="on" /><i className="on" />
      </span>
    </div>
  );
}

export default function SlowProcessingScreen({ photos = [], draft, onNavigate }) {
  const total = photos.length || 5;
  const ready = Math.max(0, total - 1);
  const waitingPage = total;

  return (
    <div className="form-shell">
      <StepHeader />
      <div className="app-eyebrow">Creating {draft?.title || "your book"}</div>
      <h1>Four pages are ready.</h1>
      <p className="lead">
        One page needs a little longer. You can look through the finished pages while it catches up.
      </p>

      <div className="book-ribbon" role="list" aria-label={`${ready} of ${total} pages ready`}>
        {photos.length > 0 ? photos.slice(0, total).map((photo, index) => (
          <React.Fragment key={photo.id || `${photo.name}-${index}`}>
            {index > 0 && <span className="ribbon-spine" aria-hidden="true" />}
            <div className={`ribbon-page${index >= ready ? " waiting" : ""}`} role="listitem">
              {index < ready
                ? <img src={photo.preview} alt={`Page ${index + 1} ready`} />
                : <span aria-label={`Page ${waitingPage} is still processing`}>···</span>}
            </div>
          </React.Fragment>
        )) : Array.from({ length: total }, (_, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="ribbon-spine" aria-hidden="true" />}
            <div className={`ribbon-page${index >= ready ? " waiting" : ""}`} role="listitem">
              {index < ready ? <span>Page {index + 1}</span> : <span aria-label={`Page ${waitingPage} is still processing`}>···</span>}
            </div>
          </React.Fragment>
        ))}
      </div>

      <div className="progress-summary" aria-live="polite">
        <div className="progress-number">{ready}<span style={{ fontSize: 12, color: "var(--muted-2)" }}> / {total}</span></div>
        <div>
          <strong>One page is taking longer</strong>
          <small>The other pages are safe. Nothing needs to restart.</small>
          <div className="progress-track" style={{ marginTop: 8 }}>
            <div className="progress-fill" style={{ width: `${(ready / total) * 100}%` }} />
          </div>
        </div>
        <span className="pill gold"><span className="dot" />Working</span>
      </div>

      <div className="info-callout">
        <span className="check" aria-hidden="true">i</span>
        <span><strong>Still working on page {waitingPage}.</strong> Review the {ready} finished pages now, or retry only the page that is delayed.</span>
      </div>

      <div className="form-footer">
        <small>Estimated remaining time: about 2 minutes</small>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="button secondary" type="button" onClick={() => onNavigate("issue", "Page needs a retry")}>
            Retry page {waitingPage}
          </button>
          <button className="button primary" type="button" onClick={() => onNavigate("review", "Review finished pages")}>
            Review ready pages <span className="arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </div>
  );
}
