import React from "react";

const ages = Array.from({ length: 10 }, (_, index) => index + 3);

export default function BookDetailsScreen({ draft, onDraftChange, onNavigate }) {
  return (
    <div className="form-shell">
      <div className="step-head">
        <span className="step-label">
          <strong>Step 1 of 4</strong> · Create your book
        </span>
        <span className="step-track" aria-label="Step 1 of 4">
          <i className="on" />
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="app-eyebrow">First, tell us who this book is for</div>
      <h1>Give this book a name.</h1>
      <p className="lead">
        We’ll use these details to personalize the cover and choose the right
        level of detail. You can change them later.
      </p>

      <div className="form-row">
        <div className="field">
          <label htmlFor="child-name">Child’s first name</label>
          <input
            id="child-name"
            type="text"
            autoComplete="given-name"
            value={draft.childName}
            onChange={(event) => onDraftChange({ childName: event.target.value })}
          />
          <small>This appears on the cover if you want it to.</small>
        </div>
        <div className="field">
          <label htmlFor="child-age">Age</label>
          <select
            id="child-age"
            value={draft.age}
            onChange={(event) => onDraftChange({ age: Number(event.target.value) })}
          >
            {ages.map((age) => <option key={age} value={age}>{age} years</option>)}
          </select>
          <small>Used to set the amount of detail in each page.</small>
        </div>
      </div>

      <div className="field">
        <label htmlFor="book-name">Book title</label>
        <input
          id="book-name"
          type="text"
          value={draft.title}
          onChange={(event) => onDraftChange({ title: event.target.value })}
        />
        <small>You can edit the title before ordering.</small>
      </div>

      <div className="form-footer">
        <small>Next, choose 5–10 photos. You can review every page before you order.</small>
        <button type="button" className="button primary" onClick={() => onNavigate("upload")}>
          Choose photos <span className="arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </div>
  );
}
