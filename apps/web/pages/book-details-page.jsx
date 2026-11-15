import React, { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { WizardShell } from "./wizard-shell.jsx";
import { useCreateBook } from "../hooks/use-create-book.js";
import styles from "./book-details-page.module.css";

/**
 * Step 1 of 4 — Book details.
 * Collects childName and title; on submit calls createBook
 * and navigates to /books/new/photos?bookId=<id>.
 */
export function BookDetailsPage() {
  const navigate = useNavigate();
  const { mutateAsync: createBook, isPending, error } = useCreateBook();

  const [form, setForm] = useState({
    childName: "",
    title: "",
  });

  function update(patch) {
    setForm(prev => ({ ...prev, ...patch }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const { bookId } = await createBook({
      title: form.title || undefined,
      childName: form.childName || undefined,
    });
    navigate({ to: "/books/new/photos", search: { bookId } });
  }

  return (
    <WizardShell step={1}>
      <header className={styles.header}>
        <span className={styles.eyebrow}>
          First, tell us who this book is for
        </span>
        <h1 className={styles.heading}>Give this book a name.</h1>
        <p className={styles.lead}>
          We'll use these details to personalise the cover and choose the right
          level of detail. You can change them later.
        </p>
      </header>

      <form onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.field}>
          <label htmlFor="child-name" className={styles.label}>
            Child's first name
          </label>
          <input
            id="child-name"
            type="text"
            autoComplete="given-name"
            className={styles.input}
            value={form.childName}
            onChange={e => update({ childName: e.target.value })}
            placeholder="e.g. Lily"
          />
          <span className={styles.hint}>
            This appears on the cover if you want it to.
          </span>
        </div>

        <div className={styles.field}>
          <label htmlFor="book-title" className={styles.label}>
            Book title
          </label>
          <input
            id="book-title"
            type="text"
            className={styles.input}
            value={form.title}
            onChange={e => update({ title: e.target.value })}
            placeholder="e.g. Our summer with Lily"
          />
          <span className={styles.hint}>
            You can edit the title before ordering.
          </span>
        </div>

        {error && (
          <p className={styles.errorMsg} role="alert">
            {error.message ?? "Something went wrong. Please try again."}
          </p>
        )}

        <div className={styles.footer}>
          <span className={styles.footerNote}>
            Next, choose 5–20 photos. You can review every page before ordering.
          </span>
          <button type="submit" className={styles.ctaBtn} disabled={isPending}>
            {isPending ? "Creating…" : "Choose photos →"}
          </button>
        </div>
      </form>
    </WizardShell>
  );
}
