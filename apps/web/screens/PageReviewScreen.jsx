import React from "react";
import sourceExample from "../../landing/public/images/hero_main.optimized.webp";
import coloringExample from "../../landing/public/images/feature_book.optimized.webp";

/** Customer-facing review state for one generated coloring page. */
export default function PageReviewScreen({
  approved = false,
  compare = false,
  issue = false,
  onApprove,
  onToggleCompare,
  onNavigate,
}) {
  const heading = issue ? "This page needs another look." : "A page from Milo’s book";

  return <>
    <header className="app-head">
      <div>
        <div className="app-eyebrow">Page 02 of 05</div>
        <h1>{heading}</h1>
        <p>{issue
          ? "A quick retake can bring back the details from your photo."
          : "Check the details, then keep this page or ask for another version."}</p>
      </div>
    </header>

    <div className="review-layout">
      <div>
        <div className={`review-paper${compare ? " compare-on" : ""}`}>
          <img
            src={compare ? sourceExample : coloringExample}
            alt={compare ? "Example source photo" : "Sample coloring page of a house"}
          />
        </div>
        <div className="compare-row">
          <span>{compare ? "Example source photo" : "Coloring page preview"}</span>
          <button
            className="button ghost"
            type="button"
            onClick={onToggleCompare}
            aria-pressed={compare}
          >{compare ? "Show page" : "Compare with photo"}</button>
        </div>
        <nav className="page-tabs" aria-label="Book pages">
          {[1, 2, 3, 4, 5].map((number) => <button
            key={number}
            type="button"
            className={`page-tab${number === 2 ? " selected" : ""}`}
            aria-label={`Page ${number}${number === 2 ? ", current page" : ""}`}
            aria-current={number === 2 ? "page" : undefined}
            disabled={number !== 2}
          >{number}</button>)}
        </nav>
      </div>

      <aside className="review-tools" aria-label="Page review actions">
        <span className={`pill${issue ? " gold" : ""}`}>
          <span className="dot" />{issue ? "Needs a change" : "Ready to keep"}
        </span>
        <h2 style={{ marginTop: 12 }}>{issue ? "One page needs help" : "A page made from your photo"}</h2>
        <p>{issue
          ? "We’ll reuse your source photo and leave the rest of the book alone."
          : "Your child’s photo becomes a simple page with large areas to color."}</p>

        {issue ? <div className="issue-card" role="status">
          <span className="issue-mark">!</span>
          <span><strong>The photo was too dim to read clearly.</strong><br />
            We can try again from the same photo. Your other pages will stay as they are.</span>
        </div> : <div aria-label="Quality checks">
          <div className="quality-row"><span>Print check</span><strong>Ready</strong></div>
          <div className="quality-row"><span>Style check</span><strong>Ready</strong></div>
        </div>}

        <div className="tool-divider" />
        <div className="tool-actions">
          {issue ? <>
            <button className="button primary" type="button" onClick={() => onNavigate("processing", "Retry this page")}>
              Try this page again
            </button>
            <button className="button secondary" type="button" onClick={() => onNavigate("preview", "Keep current page")}>
              Use this page anyway
            </button>
          </> : <>
            <button className={`button ${approved ? "soft" : "primary"}`} type="button" onClick={onApprove}>
              {approved ? "Page saved ✓" : "Keep this page"}
            </button>
            <button className="button secondary" type="button" onClick={() => onNavigate("issue", "Request another version")}>
              Try another version
            </button>
          </>}
          <button className="button ghost" type="button" onClick={() => onNavigate("preview", "Preview the book")}>
            Preview the whole book
          </button>
        </div>
      </aside>
    </div>
  </>;
}
