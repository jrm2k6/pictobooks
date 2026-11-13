import React from "react";

export default function EmailConfirmationScreen({ email, onNavigate, onResend }) {
  return (
    <section className="confirmation" aria-labelledby="email-confirmation-title">
      <div className="confirmation-inner">
        <div className="confirmation-badge" aria-hidden="true">@</div>
        <div className="app-eyebrow">Check your inbox</div>
        <h1 id="email-confirmation-title">Your sign-in link is on its way.</h1>
        <p>
          We sent a secure link to <strong>{email || "your email address"}</strong>.
          Open it to see your books and continue creating.
        </p>

        <div className="form-footer" style={{ justifyContent: "center", flexWrap: "wrap" }}>
          <button
            className="button secondary"
            type="button"
            onClick={() => onNavigate("account", "Edit address")}
          >Use a different email</button>
          <button className="button ghost" type="button" onClick={onResend}>
            Resend link
          </button>
          <button
            className="button primary"
            type="button"
            onClick={() => onNavigate("library", "Sign-in link opened")}
          >Continue to My books</button>
        </div>

        <p className="account-privacy" role="status">
          This is a prototype. No email has been sent and no account has been created.
        </p>
      </div>
    </section>
  );
}
