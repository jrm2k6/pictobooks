import React from "react";
import inProgressExample from "../../landing/public/images/hero_main.optimized.webp";
import homeBookExample from "../../landing/public/images/feature_book.optimized.webp";
import parkBookExample from "../../landing/public/images/feature_ages.optimized.webp";

export default function BookshelfScreen({ draft, onNavigate }) {
  return <>
    <header className="app-head">
      <div>
        <div className="app-eyebrow">Your bookshelf</div>
        <h1>Books for {draft.childName || "your family"}</h1>
        <p>Pick up where you left off, or turn a new set of photos into a book.</p>
      </div>
      <button className="button primary" type="button" onClick={() => onNavigate("create", "Create book")}>
        Create a book <span className="arrow" aria-hidden="true">→</span>
      </button>
    </header>

    <section className="library-banner" aria-labelledby="active-book-title">
      <div className="library-copy">
        <span className="pill gold">IN PROGRESS <span className="dot" /></span>
        <h2 id="active-book-title">{draft.title || "Our days with Pippin"}</h2>
        <p>Five photos are becoming a coloring book for {draft.childName || "your child"}. Four pages are ready to look through.</p>
        <button className="button primary" type="button" onClick={() => onNavigate("review", "Review ready pages")}>
          Review ready pages
        </button>
        <div className="statline" aria-label="Book progress">
          <div><strong>4 of 5</strong>pages ready</div>
          <div><strong>Age {draft.age || 5}</strong>detail level</div>
          <div><strong>Updated</strong>just now</div>
        </div>
      </div>
      <div className="library-cover">
        <img className="book-art" src={inProgressExample} alt="A family photo transformed into a puppy coloring page" />
      </div>
    </section>

    <div className="section-title">
      <h2>Earlier books</h2>
      <span>Saved for {draft.childName || "your family"}</span>
    </div>
    <div className="book-grid">
      <article className="book-card">
        <img src={homeBookExample} alt="A house coloring page in an open book" />
        <div>
          <h3>A little book of home</h3>
          <p>8 pages · Created for {draft.childName || "your child"}</p>
          <div className="book-meta">
            <span>PDF ready</span>
            <button className="button ghost" type="button" onClick={() => onNavigate("preview", "Open an earlier book")}>Open →</button>
          </div>
        </div>
      </article>
      <article className="book-card">
        <img src={parkBookExample} alt="Coloring pages inspired by a day at the park" />
        <div>
          <h3>Park days</h3>
          <p>6 pages · Created for {draft.childName || "your child"}</p>
          <div className="book-meta">
            <span>Printed edition</span>
            <button className="button ghost" type="button" onClick={() => onNavigate("complete", "View order status")}>Order status →</button>
          </div>
        </div>
      </article>
    </div>

    <div className="info-callout">
      <span className="check" aria-hidden="true">i</span>
      <span>Photos stay private to your books. You choose which pages to keep before ordering.</span>
    </div>
  </>;
}
