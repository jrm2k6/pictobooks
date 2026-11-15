import React from "react";
import "./login.css";
import "./clerk-overrides.css";
import "./tokens.css";
import styles from "./auth-layout.module.css";

export const clerkAppearance = {
  variables: {
    colorPrimary: "#e96752",
    colorTextOnPrimaryBackground: "#ffffff",
    colorText: "#203649",
    colorTextSecondary: "#73818b",
    colorBackground: "transparent",
    colorInputBackground: "#ffffff",
    colorInputText: "#203649",
    fontFamily: '"Plus Jakarta Sans", "Segoe UI", sans-serif',
    fontFamilyButtons: '"Plus Jakarta Sans", "Segoe UI", sans-serif',
    fontSize: "14px",
    borderRadius: "8px",
  },
  elements: {
    rootBox: { width: "100%", maxWidth: "100%", minWidth: 0 },
    cardBox: { width: "100%", maxWidth: "100%", minWidth: 0, boxShadow: "none", border: "none", overflow: "visible", padding: "0 4px" },
    card: { gap: "0px", padding: "16px 0", backgroundColor: "transparent", boxShadow: "none", border: "none" },
    main: { gap: "16px" },
    form: { gap: "12px" },
    header: { display: "none" },
    footer: { display: "none" },
    formFieldInput: { height: "51px" },
    formButtonPrimary: { fontWeight: 800, fontSize: "13px", marginTop: "4px" },
    socialButtonsBlockButton: { border: "1px solid #d9dfde" },
    dividerRow: { margin: "4px 0" },
    dividerText: { color: "#a2aaa9", fontSize: "10px" },
    dividerLine: { backgroundColor: "#ebeeea" },
  },
};

function StoryPanel() {
  return (
    <section className="login-story" aria-labelledby="story-title">
      <a className="login-brand" href="https://pictobook.app/" aria-label="Pictobook home">
        <img src="/images/pictobook-logo.webp" alt="" height="32" />
        <span>Pictobook</span>
      </a>

      <div className="story-copy">
        <span className="login-eyebrow"><span aria-hidden="true">✳</span> A little more magic at home</span>
        <h1 id="story-title">Their favorite moments, made <em>colorful.</em></h1>
        <p>Turn the photos you love into a coloring book made just for your child.</p>
      </div>

      <div className="book-illustration" aria-hidden="true">
        <div className="sun-shape" />
        <div className="book-shadow" />
        <div className="book-spread">
          <div className="book-page book-page-left">
            <span className="page-sun" />
            <svg viewBox="0 0 160 170" role="presentation">
              <path d="M30 138c4-35 25-57 51-57s47 22 51 57M47 80c1-24 13-38 34-38s33 14 34 38M64 49c-9-14-4-29 7-34m21 32c14-11 14-25 5-34M55 96c-8-3-14-1-18 5m88-1c-5-5-11-6-18-3M66 124h1m28 0h1" />
              <path d="M73 67c3 2 6 2 9 0m8 0c3 2 6 2 9 0M72 83c8 7 17 7 25 0" />
            </svg>
            <span className="page-caption">a day to remember</span>
          </div>
          <div className="book-page book-page-right">
            <div className="page-doodle">
              <span className="doodle-star">✦</span>
              <svg viewBox="0 0 150 160" role="presentation">
                <path d="M75 132c-12-17-38-37-38-62a22 22 0 0 1 38-15 22 22 0 0 1 38 15c0 25-26 45-38 62Z" />
                <path d="M51 75c8-9 15-9 23 0m8 0c8-9 15-9 23 0m-49 9c13 10 27 10 40 0m-27 23c7 5 13 5 20 0" />
                <path d="m28 45 5 7m89 14 7-4M47 121l-7 6m75 5 8 7" />
              </svg>
              <span className="doodle-heart">♡</span>
            </div>
            <span className="page-caption">made just for you</span>
          </div>
        </div>
        <span className="floating-star star-one" aria-hidden="true">✳</span>
        <span className="floating-star star-two" aria-hidden="true">✦</span>
        <span className="floating-dot dot-one" aria-hidden="true" />
        <span className="floating-dot dot-two" aria-hidden="true" />
      </div>

      <div className="story-footnote">
        <span className="footnote-check" aria-hidden="true">✓</span> A keepsake made from your family's own stories
      </div>
    </section>
  );
}

export function AuthLayout({ kicker, heading, intro, toggleText, toggleHref, toggleLinkText, children }) {
  return (
    <main className="login-page">
      <StoryPanel />
      <section className="login-panel" aria-labelledby="auth-title">
        <div className="login-form-wrap">
          <div className="mobile-brand" aria-hidden="true">
            <img src="/images/pictobook-logo.webp" alt="" height="28" />
            <span>Pictobook</span>
          </div>
          <span className="form-kicker">{kicker}</span>
          <h2 id="auth-title">{heading}</h2>
          <p className="form-intro">{intro}</p>
          <div style={{ marginTop: "28px", padding: "0 8px" }}>{children}</div>
          {toggleText && (
            <p className={styles.toggleRow}>
              {toggleText}{" "}
              <a href={toggleHref} className={styles.toggleLink}>{toggleLinkText}</a>
            </p>
          )}
          <p className={`login-legal ${styles.legal}`}>
            By continuing, you agree to our{" "}
            <a href="https://pictobook.app/legal/terms-of-service">Terms</a> and{" "}
            <a href="https://pictobook.app/legal/privacy-policy">Privacy Policy</a>.
          </p>
        </div>
        <footer className="login-footer">
          <span>© {new Date().getFullYear()} Pictobook</span>
        </footer>
      </section>
    </main>
  );
}
