import React from "react";
import { AppShell } from "./app-shell.jsx";
import styles from "./books-page.module.css";

export function BooksPage() {
  return (
    <AppShell>
      <div className={styles.emptyState}>
        <div className={styles.iconWrap}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden="true">
            <path d="M6 8h20M6 13h20M6 18h12" stroke="var(--color-coral)" strokeWidth="1.75" strokeLinecap="round" />
            <circle cx="23" cy="22" r="6" fill="oklch(from var(--color-coral) l c h / 0.12)" stroke="var(--color-coral)" strokeWidth="1.5" />
            <path d="M23 19.5v5M20.5 22h5" stroke="var(--color-coral)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
        <div>
          <h1 className={styles.heading}>No books yet</h1>
          <p className={styles.subheading}>Create your first coloring book from family photos.</p>
        </div>
        <button className={styles.cta}>Create a book</button>
      </div>
    </AppShell>
  );
}
