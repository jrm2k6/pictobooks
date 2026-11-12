import React from "react";

export default function GenerationErrorScreen({ onNavigate }) {
  return (
    <section className="error-panel" aria-labelledby="generation-error-title">
      <span className="pill gold"><span className="dot" />Page generation paused</span>
      <h1 id="generation-error-title">We couldn’t finish page 5.</h1>
      <p>The photo is still saved. The other four pages are ready, and you can retry just this one page.</p>
      <div className="error-detail">Page 5 · Needs a new attempt · 4 pages ready</div>
      <button className="button primary" type="button" onClick={() => onNavigate("issue", "Retry page")}>
        Retry page 5
      </button>
      <button className="button ghost" type="button" onClick={() => onNavigate("library", "Return to book")}>
        Return to My books
      </button>
    </section>
  );
}
