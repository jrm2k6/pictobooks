import React from "react";
import transformationExample from "../../landing/public/images/hero_main.optimized.webp";

export default function FirstVisitScreen({ onNavigate }) {
  return (
    <div className="empty-state">
      <div className="empty-art">
        <div className="empty-blob" aria-hidden="true" />
        <img
          src={transformationExample}
          alt="A puppy photo transformed into a coloring page"
        />
      </div>

      <div className="empty-copy">
        <div className="app-eyebrow">A book made from your moments</div>
        <h1>Your family stories belong on the page.</h1>
        <p>
          Choose five to ten photos. We’ll turn them into a coloring book your
          child can make their own.
        </p>
        <div className="micro-list">
          <span><i className="check" aria-hidden="true">✓</i> A page inspired by every photo</span>
          <span><i className="check" aria-hidden="true">✓</i> Made for ages 3–12</span>
          <span><i className="check" aria-hidden="true">✓</i> Preview before you order</span>
        </div>
        <button
          className="button primary"
          type="button"
          onClick={() => onNavigate("create", "Start a book")}
        >
          Start a book <span className="arrow" aria-hidden="true">→</span>
        </button>
        <div style={{ marginTop: 10 }}>
          <button
            className="button ghost"
            type="button"
            onClick={() => onNavigate("upload", "See how it works")}
          >See how it works</button>
        </div>
      </div>
    </div>
  );
}
