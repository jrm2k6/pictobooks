import React from "react";
import printedBookExample from "../../landing/public/images/feature_book.optimized.webp";

const editions = [
  {
    id: "print",
    badge: "MADE TO HOLD",
    title: "Printed coloring book",
    description: "A softcover book delivered to your door. Paper and shipping details are still being finalized.",
    price: "$24.00",
  },
  {
    id: "pdf",
    badge: "INSTANT DOWNLOAD",
    title: "Digital PDF",
    description: "Download the pages and print them whenever your child wants a fresh copy.",
    price: "$12.00",
  },
];

export default function EditionSelectionScreen({ format, onFormatChange, onNavigate }) {
  return <>
    <header className="app-head">
      <div>
        <div className="app-eyebrow">Choose how to keep it</div>
        <h1>A book for coloring, your way.</h1>
        <p>Choose a printed book for little hands, or download a PDF to print at home.</p>
      </div>
    </header>

    <div className="edition-grid" role="radiogroup" aria-label="Choose an edition">
      {editions.map((edition) => <label
        key={edition.id}
        className={`edition-card${format === edition.id ? " selected" : ""}`}
      >
        <input
          className="edition-choice"
          type="radio"
          name="book-edition"
          value={edition.id}
          checked={format === edition.id}
          onChange={() => onFormatChange(edition.id)}
        />
        <span className="edition-art">
          {edition.id === "print"
            ? <img src={printedBookExample} alt="Example coloring book" />
            : <span aria-hidden="true">PDF</span>}
        </span>
        <span>
          <span className={`pill ${edition.id === "print" ? "gold" : "gray"}`}>{edition.badge}</span>
          <span className="edition-title">{edition.title}</span>
          <span className="edition-description">{edition.description}</span>
          <span className="edition-price">{edition.price}<span className="prototype-price">Sample price · not final</span></span>
        </span>
      </label>)}
    </div>

    <div className="info-callout">
      <span className="check" aria-hidden="true">i</span>
      <span>These prices are for prototype review only. Production pricing, page count, and print specifications are not connected yet.</span>
    </div>

    <div className="form-footer">
      <small>You can still go back and change a page before placing an order.</small>
      <button className="button primary" type="button" onClick={() => onNavigate("checkout", "Continue to delivery")}>
        Continue to delivery <span className="arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </>;
}
