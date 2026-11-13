import React, { useState } from "react";
import coverExample from "../../landing/public/images/hero_main.optimized.webp";
import pageOneExample from "../../landing/public/images/feature_book.optimized.webp";
import pageTwoExample from "../../landing/public/images/feature_ages.optimized.webp";
import pageThreeExample from "../../landing/public/images/feature_upload.optimized.webp";

const pageExamples = [pageOneExample, pageTwoExample, pageThreeExample, pageOneExample, pageTwoExample];

export default function BookPreviewScreen({ photos = [], draft, approved = false, onNavigate }) {
  const [spreadIndex, setSpreadIndex] = useState(0);
  const pageCount = photos.length;
  const spreadCount = Math.max(1, Math.ceil((pageCount + 1) / 2));
  const firstPage = spreadIndex === 0 ? coverExample : pageExamples[(spreadIndex * 2 - 1) % pageExamples.length];
  const secondPage = pageExamples[(spreadIndex === 0 ? 0 : spreadIndex * 2) % pageExamples.length];
  const firstLabel = spreadIndex === 0 ? "Book cover preview" : `Coloring page ${spreadIndex * 2}`;
  const secondNumber = spreadIndex === 0 ? 1 : spreadIndex * 2 + 1;

  return <>
    <header className="app-head">
      <div>
        <div className="app-eyebrow">Your book · {pageCount} pages</div>
        <h1>Take a look through the book.</h1>
        <p>{pageCount} photo-inspired pages, made for {draft.childName}. The cover title can still be changed.</p>
      </div>
    </header>

    <div className="book-preview-layout">
      <div>
        <div className="spread" aria-live="polite">
          <div className="spread-page">
            <img src={firstPage} alt={firstLabel} />
          </div>
          <div className="spread-page">
            <img src={secondPage} alt={`Coloring page ${secondNumber} preview`} />
          </div>
        </div>
        <div className="section-title">
          <button
            className="button ghost"
            type="button"
            onClick={() => setSpreadIndex((index) => Math.max(0, index - 1))}
            disabled={spreadIndex === 0}
            aria-label="Previous book spread"
          >← Previous spread</button>
          <span className="pill gray">{spreadIndex === 0 ? "Cover · pages 1–2" : `Pages ${spreadIndex * 2}–${Math.min(spreadIndex * 2 + 1, pageCount)} of ${pageCount}`} of {pageCount}</span>
          <button
            className="button ghost"
            type="button"
            onClick={() => setSpreadIndex((index) => Math.min(spreadCount - 1, index + 1))}
            disabled={spreadIndex >= spreadCount - 1}
            aria-label="Next book spread"
          >Next spread →</button>
        </div>
      </div>

      <aside className="book-facts" aria-label="Book details">
        <h2>{draft.title}</h2>
        <div className="fact-row">Made for<strong>{draft.childName} · age {draft.age}</strong></div>
        <div className="fact-row">Inside<strong>{pageCount} coloring pages</strong></div>
        <div className="fact-row">Photo selection<strong>{pageCount} moments</strong></div>
        <div className="fact-row">Review status<strong>{approved ? "Pages checked" : "Ready for your review"}</strong></div>
        <div style={{ marginTop: 15 }}>
          <button className="button primary" type="button" onClick={() => onNavigate("edition")}>
            Choose an edition <span className="arrow" aria-hidden="true">→</span>
          </button>
        </div>
        <div style={{ marginTop: 8 }}>
          <button className="button ghost" type="button" onClick={() => onNavigate("review")}>Back to page review</button>
        </div>
      </aside>
    </div>
  </>;
}
