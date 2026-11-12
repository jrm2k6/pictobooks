import React from "react";

export default function SignInScreen({ email, onEmailChange, onNavigate }) {
  const handleSubmit = (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    onNavigate("account-sent", "Continue with email");
  };

  return (
    <form className="form-shell account-form" onSubmit={handleSubmit}>
      <div className="account-symbol" aria-hidden="true">p</div>
      <div className="app-eyebrow">Your books, together</div>
      <h1>Sign in or create an account.</h1>
      <p className="lead">We’ll save your photos, book previews, and orders in one private place.</p>

      <div className="field">
        <label htmlFor="account-email">Email address</label>
        <input
          id="account-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => onEmailChange(event.currentTarget.value)}
        />
      </div>

      <div className="form-footer">
        <small>No password to remember. We’ll send a secure sign-in link.</small>
        <button className="button primary" type="submit">
          Continue with email <span className="arrow" aria-hidden="true">→</span>
        </button>
      </div>
      <p className="account-privacy">
        By continuing, you agree to the Terms and Privacy Policy. This prototype does not create an account or send email.
      </p>
    </form>
  );
}
