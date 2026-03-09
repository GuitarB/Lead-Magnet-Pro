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
- **Database schema**: `db/schema.sql` (Cloudflare D1)

## Environment variables

Set these in Cloudflare Pages:

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_BUILDER`
- `STRIPE_PRICE_FOUNDER`
- `SITE_URL` (optional; defaults to request origin)

Also bind D1 to Pages Functions as `DB`.

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

