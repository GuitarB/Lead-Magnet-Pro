# Lead-Magnet Pro

Lead-Magnet Pro is a Cloudflare Pages SaaS that generates format-aware lead magnets with OpenAI and now renders true server-side PDFs.

## Architecture

- **Frontend app**: `index.html` (vanilla JS + Tailwind CDN)
- **Generate HTML**: `functions/api/generate.js`
- **Render PDF (server-side)**: `functions/api/render-pdf.js`
- **Fetch PDF from R2**: `functions/api/pdf.js`
- **Workspace + history**: `functions/api/workspace.js`
- **PDF template layer**: `functions/lib/pdf-template.js`
- **Billing/checkout/session**: existing Stripe functions under `functions/api/*`
- **Database schema**: `db/schema.sql` (Cloudflare D1)

## Required bindings and environment

### Bindings

- `DB` (D1)
- `PDF_BUCKET` (R2)
- `BROWSER` (Cloudflare Browser Rendering)

Browser Rendering binding is configured in `wrangler.jsonc`:

```jsonc
"browser": {
  "binding": "BROWSER"
}
```

### Environment variables

- `OPENAI_API_KEY`
- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_BUILDER`
- `STRIPE_PRICE_FOUNDER`
- `SITE_URL` (optional; defaults to request origin)

## PDF pipeline flow

1. User generates HTML through `/api/generate`.
2. Frontend calls `/api/render-pdf` with generation context + HTML.
3. Server builds a dedicated standalone PDF document template (no dashboard chrome).
4. Cloudflare Browser Rendering generates the PDF.
5. PDF is uploaded to R2 (`PDF_BUCKET`) and key/path metadata is returned.
6. `/api/pdf?key=...` streams the file inline or as download (`&download=1`).
7. If the generation is tied to a saved paid generation row, `pdf_key` metadata is persisted in D1.

## API endpoints

### `POST /api/render-pdf`

Accepts JSON:

- `title`
- `sourceUrl`
- `leadMagnetType`
- `audience`
- `primaryGoal`
- `generatedHtml`
- optional metadata (`workspaceName`, `customerId`, `generationCreatedAt`)

Returns:

- `success`
- `pdfKey`
- `pdfUrl`
- `pageCount`
- `previewPages`

### `GET /api/pdf?key=<R2 key>[&download=1]`

- Streams PDF from R2 with `Content-Type: application/pdf`.
- Uses inline disposition by default.
- Uses attachment disposition when `download=1`.

## D1 setup

Run schema:

```bash
wrangler d1 execute <YOUR_DB_NAME> --file=db/schema.sql
```

`generations` now includes `pdf_key` and `pdf_created_at` for reusing previously rendered PDFs in workspace history.

## Deployment notes

- Ensure Browser Rendering is enabled on your Cloudflare account.
- Ensure `PDF_BUCKET` exists and is bound in Pages.
- Ensure D1 schema includes the new PDF metadata columns.
- Deploy both frontend and functions together so action buttons target the new PDF endpoints.

## Local dev

```bash
npm install
npm run dev
```
