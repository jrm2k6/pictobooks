import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./login.css";

function LoginApp() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");

  const submit = (event) => {
    event.preventDefault();
    setMessage("Sign-in is not connected yet. We’re getting your Pictobook account ready.");
  };

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="story-title">
        <a className="login-brand" href="https://pictobook.app/" aria-label="Pictobook home">
          <span className="login-brand-mark" aria-hidden="true">p</span>
          <span>pictobook</span>
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

        <div className="story-footnote"><span className="footnote-check" aria-hidden="true">✓</span> A keepsake made from your family’s own stories</div>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-form-wrap">
          <div className="mobile-brand" aria-hidden="true"><span className="login-brand-mark">p</span> pictobook</div>
          <span className="form-kicker">Welcome back</span>
          <h2 id="login-title">Your books are waiting.</h2>
          <p className="form-intro">Sign in to pick up where your family left off.</p>

          <form className="login-form" onSubmit={submit}>
            <label htmlFor="login-email">Email address</label>
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              autoCapitalize="none"
              placeholder="you@example.com"
              required
              value={email}
              onChange={(event) => {
                setEmail(event.currentTarget.value);
                setMessage("");
              }}
            />
            <button className="login-submit" type="submit">Continue with email <span aria-hidden="true">→</span></button>
            <p className="login-hint">No password to remember. We’ll use a secure sign-in link.</p>
            <p className="login-message" role="status" aria-live="polite">{message}</p>
          </form>

          <div className="login-divider"><span>made for the moments that matter</span></div>
          <p className="login-legal">By continuing, you agree to our <a href="https://pictobook.app/legal/terms-of-service">Terms</a> and <a href="https://pictobook.app/legal/privacy-policy">Privacy Policy</a>.</p>
        </div>
        <footer className="login-footer">
          <span>© {new Date().getFullYear()} Pictobook</span>
          {import.meta.env.DEV && <a href="/storybook">Open local prototype ↗</a>}
        </footer>
      </section>
    </main>
  );
}

if (window.location.pathname !== "/login") {
  window.history.replaceState(null, "", "/login");
}
document.title = "Sign in · Pictobook";
createRoot(document.getElementById("root")).render(<LoginApp />);
