# Customer product prototype

## Brief

Self-authored from the existing product and repo. Pictobook helps a parent turn
five to ten family, pet, or adventure photos into a personalized coloring book
for a child aged 3–12. The customer flow should make it easy to start a book,
check the generated pages, choose a digital or printed edition, and place an
order. This is a review prototype; upload, generation, payment, and fulfillment
are not connected.

The live site at pictobook.app currently explains the photo-to-coloring-book
idea, the age range, a five-to-ten-photo input, and instant PDF delivery. The
repo also contains the current brand assets and typography, plus a working
generation and review pipeline. The prototype carries those facts into the
product flow instead of inventing finalized print prices or delivery promises.

## Category default refused

The app is not a marketing page inside a dashboard shell. The core screen is
the customer's own book: its photos, page progress, and preview. No KPI cards,
fake reviews, or decorative AI status badges.

## Three directions

1. **Pictobook Studio** — the existing coral and ink identity, with a quiet
   work surface and the book pages as the main content. The strongest bridge
   from the live brand to a useful customer app. Chosen for the full storybook.
2. **Photo index** — a cool white and cobalt contact sheet with a strict
   grotesk grid. Fast and legible, but less connected to the warmth of the
   current brand.
3. **Picture world** — deep blue-green, rounded type, and bright page-color
   accents. Memorable for a child's experience, but too theatrical for a
   parent-facing order workflow.

## Direction and tokens

- Surface: clean warm white, with a pale coral stage and ink-blue text.
- Accent: Pictobook coral for the primary action; gold marks selected or
  celebratory states. Color does not carry status by itself.
- Type: Plus Jakarta Sans for product UI; Fraunces only for book titles and
  expressive moments, consistent with the live identity.
- Layout: a compact customer nav and a book-first workspace. Dividers and
  spacing carry hierarchy; cards are reserved for actual photos, pages, and
  choices.
- Signature: the page ribbon fills as generated pages become ready. In review,
  the customer can compare a source-photo story with its coloring-page result.
- Voice: warm and specific, like a thoughtful print shop that explains what
  happens next.

## Screens and states

The local storybook exposes URLs for the library, first-use empty state,
email sign-in and confirmation, book setup, photo upload, photo ordering,
generation progress, slow/partial generation, page review, a page that needs a
change, whole-book preview, edition choice, checkout, order confirmation,
upload error, and generation error.
Screen navigation and three visual directions are available in the storybook
toolbar; each story has a short review note.

## Prototype data

The interface uses existing Pictobook marketing images and static sample copy.
Format prices and shipping figures are explicitly marked as prototype values.
Email sign-in is a design assumption. No customer account, personal photos,
billing, or fulfillment service is connected.
