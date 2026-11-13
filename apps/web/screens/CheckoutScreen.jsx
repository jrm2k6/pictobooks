import React from "react";

const editionPrices = { print: 24, pdf: 12 };
const shippingPrice = 4.95;

export default function CheckoutScreen({ draft, email, format, onEmailChange, onNavigate }) {
  const isPrint = format === "print";
  const itemPrice = editionPrices[isPrint ? "print" : "pdf"];
  const total = itemPrice + (isPrint ? shippingPrice : 0);

  const handleSubmit = (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    onNavigate("complete", "Place order");
  };

  return <>
    <header className="app-head">
      <div>
        <div className="app-eyebrow">Final step</div>
        <h1>Where should we send it?</h1>
        <p>Check the details before ordering. This prototype does not collect payment.</p>
      </div>
    </header>

    <form className="checkout-grid" onSubmit={handleSubmit}>
      <div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="checkout-first-name">First name</label>
            <input id="checkout-first-name" name="firstName" autoComplete="given-name" defaultValue="Jamie" required />
          </div>
          <div className="field">
            <label htmlFor="checkout-last-name">Last name</label>
            <input id="checkout-last-name" name="lastName" autoComplete="family-name" defaultValue="Rivera" required />
          </div>
        </div>

        <div className="field">
          <label htmlFor="checkout-email">Email address</label>
          <input
            id="checkout-email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => onEmailChange(event.currentTarget.value)}
            required
          />
          <small>{isPrint ? "We’ll send your order confirmation here." : "We’ll send the download link here."}</small>
        </div>

        {isPrint && <>
          <div className="field">
            <label htmlFor="checkout-address">Shipping address</label>
            <input id="checkout-address" name="address" autoComplete="street-address" defaultValue="24 Garden Lane" required />
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="checkout-city">City</label>
              <input id="checkout-city" name="city" autoComplete="address-level2" defaultValue="Portland" required />
            </div>
            <div className="field">
              <label htmlFor="checkout-postal">ZIP code</label>
              <input id="checkout-postal" name="postalCode" autoComplete="postal-code" inputMode="numeric" defaultValue="97205" required />
            </div>
          </div>
        </>}

        <div className="form-footer">
          <small>Payment will be added before launch. No charge is made here.</small>
          <button className="button primary" type="submit">
            Place sample order <span className="arrow" aria-hidden="true">→</span>
          </button>
        </div>
      </div>

      <aside className="checkout-summary" aria-label="Order summary">
        <h2>Order summary</h2>
        <div className="summary-line"><span>{draft.title || "Your coloring book"}</span><strong>5 pages</strong></div>
        <div className="summary-line"><span>{isPrint ? "Printed softcover" : "Digital PDF"}</span><strong>${itemPrice.toFixed(2)}</strong></div>
        {isPrint && <div className="summary-line"><span>Shipping</span><strong>${shippingPrice.toFixed(2)}</strong></div>}
        <div className="summary-total">Sample total<strong>${total.toFixed(2)}</strong></div>
        <span className="prototype-price">Prices are illustrative only</span>
      </aside>
    </form>
  </>;
}
