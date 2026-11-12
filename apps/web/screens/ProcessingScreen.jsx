import React from "react";
import puppyPage from "../../landing/public/images/hero_main.optimized.webp";
import coloringBookPage from "../../landing/public/images/feature_book.optimized.webp";

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

export default function ProcessingScreen({ photos = [], onNavigate }) {
  const total = photos.length || 5;
  const ready = Math.min(2, total);
  const progress = total ? Math.round((ready / total) * 100) : 0;

  return (
    <div className="form-shell">
      <StepHeader />
      <div className="app-eyebrow">Creating your book</div>
      <h1>Your pages are taking shape.</h1>
      <p className="lead">
        We’re turning each photo into a page. You can leave this screen and come back at any time.
      </p>

      <div className="book-ribbon" aria-label={`${ready} of ${total} sample pages ready`}>
        {Array.from({ length: total }, (_, index) => (
          <React.Fragment key={index}>
            {index > 0 && <span className="ribbon-spine" aria-hidden="true" />}
            {index < ready ? (
              <div className="ribbon-page">
                <img src={index % 2 ? coloringBookPage : puppyPage} alt={`Page ${index + 1} ready`} />
              </div>
            ) : (
              <div className="ribbon-page waiting" aria-label={`Page ${index + 1} processing`}>···</div>
            )}
          </React.Fragment>
        ))}
      </div>

      <div
        className="progress-summary"
        role="group"
        aria-label={`${ready} of ${total} pages created`}
      >
        <div className="progress-number">{ready}<span style={{ fontSize: 12, color: "#99a39e" }}> / {total}</span></div>
        <div>
          <strong>Pages created</strong>
          <small>Your photos stay attached to the right page.</small>
          <div
            className="progress-track"
            style={{ marginTop: 8 }}
            role="progressbar"
            aria-label="Book page creation progress"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={ready}
          >
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <span className="pill"><span className="dot" />In progress</span>
      </div>

      <div className="info-callout" role="status">
        <span className="check" aria-hidden="true">i</span>
        <span><strong>No need to keep this tab open.</strong> The remaining pages can finish while you do something else.</span>
      </div>

      <div className="form-footer">
        <small>Sample progress · about 3 minutes remaining</small>
        <button
          className="button primary"
          type="button"
          onClick={() => onNavigate("review", "Pages ready")}
        >Preview what’s ready <span className="arrow" aria-hidden="true">→</span></button>
      </div>
    </div>
  );
}
