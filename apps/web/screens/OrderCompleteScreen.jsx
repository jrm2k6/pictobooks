import React from "react";

export default function OrderCompleteScreen({ draft, email, format, onNavigate }) {
  const isPdf = format === "pdf";

  return (
    <div className="confirmation">
      <div className="confirmation-inner">
        <div className="confirmation-badge" aria-hidden="true">{isPdf ? "↓" : "✓"}</div>
        <div className="app-eyebrow">{isPdf ? "Sample PDF · prototype" : "Sample order · prototype"}</div>
        <h1>{isPdf ? "Your coloring pages are ready to preview." : `${draft.childName || "Your child"}’s book is on its way.`}</h1>
        <p>
          {isPdf
            ? `${draft.title || "Your book"} is shown as ready for ${email || "your email"}. This button opens the sample book preview; there is no real PDF download yet.`
            : `We would email ${email || "you"} when the printed book is packed. “${draft.title || "Your book"}” is sample content; no order was submitted and no payment was taken.`}
        </p>

        {isPdf ? (
          <button
            className="button primary"
            type="button"
            onClick={() => onNavigate("preview", "Download PDF")}
          >View sample PDF pages <span className="arrow" aria-hidden="true">→</span></button>
        ) : (
          <div className="tracking-line" aria-label="Illustrative print order progress">
            <span className="check" aria-hidden="true">✓</span>
            <span>Sample order</span>
            <span className="progress-track" aria-hidden="true"><i className="progress-fill" style={{ display: "block", width: "27%" }} /></span>
            <span>Print preview</span>
          </div>
        )}

        <div style={{ marginTop: 11 }}>
          <button
            className="button ghost"
            type="button"
            onClick={() => onNavigate("library", "Return to My books")}
          >Back to My books</button>
        </div>
        <p className="account-privacy">This confirmation is only a prototype. It does not place an order, charge you, or send a file.</p>
      </div>
    </div>
  );
}
