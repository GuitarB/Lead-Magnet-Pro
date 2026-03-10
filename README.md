# Lead-Magnet Pro

Lead-Magnet Pro is a Cloudflare Pages SaaS that generates premium lead magnets with OpenAI.

## What changed

The app now supports subscription plans instead of a one-time unlock:

- Free
- Starter — $9/month (20 generations/month)
- Builder — $19/month (75 generations/month)
- Founder — $39/month (200 generations/month)

## Architecture

- **Frontend**: `index.html` (vanilla JS + Tailwind CDN)
- **Checkout**: `functions/api/create-checkout-session.js` (Stripe subscription checkout)
- **Session verification**: `functions/api/verify-session.js`
- **Generation + limits**: `functions/api/generate.js`
- **Workspace lookup**: `functions/api/workspace.js`
- **Billing portal placeholder**: `functions/api/manage-billing.js`
- **PDF rendering**: `functions/api/render-pdf.js` (Cloudflare Browser Rendering REST API)
- **PDF retrieval**: `functions/api/pdf.js` (R2-backed inline/download endpoint)
- **Database schema**: `db/schema.sql` (Cloudflare D1)

## Environment variables

Set these in Cloudflare Pages:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_BUILDER`
- `STRIPE_PRICE_FOUNDER`
- `SITE_URL` (optional; defaults to request origin)
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

Also bind D1 to Pages Functions as `DB` and R2 as `PDF_BUCKET`.

## D1 setup

Run the schema:

```bash
wrangler d1 execute <YOUR_DB_NAME> --file=db/schema.sql
```

## User flow

1. User fills form and selects a plan.
2. If paid plan is selected, app stores form values in `sessionStorage` and redirects to Stripe Checkout.
3. On success return, app verifies checkout session server-side and restores inputs.
4. Generation resumes automatically.
5. Paid plans are enforced against monthly generation limits in D1, and successful generations are saved.

## Local dev

```bash
npm install
npm run dev
```


## Account-lite workspace access

- Users can load a workspace by email (no password auth yet).
- The dashboard shows plan, subscription status, billing window, usage, remaining generations, and recent saved generations.
- Last loaded workspace email is persisted in `localStorage` and restored automatically.
- Saved generations can be loaded back into the result panel from the workspace list.

## Format-aware outputs and export actions

- Generation is now format-aware and produces meaningfully different HTML deliverables for Ebook, Guide, Checklist, Worksheet, Landing Page Copy, Follow-up Email Sequence, and Brand Kit Suggestions.
- The result panel includes an action row for Preview Pages, Download HTML, Export PDF, Share, and Copy HTML.
- Preview / Export / Share now route through the server-side PDF pipeline (`/api/render-pdf` -> Browser Rendering REST -> R2 -> `/api/pdf`).
- Downloaded files now use cleaner names based on brand, output type, and date (for example: `bibleautointeriors-ebook-2026-03-09.html`).
- Native share gracefully falls back when unavailable in the current browser/device.

