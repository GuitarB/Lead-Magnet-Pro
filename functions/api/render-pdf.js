import { requestBrowserRenderingPdf, toPreviewErrorResponse } from "../lib/browser-rendering";

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.PDF_BUCKET) {
      return jsonResponse({ success: false, error: "Missing PDF_BUCKET binding. Configure R2 PDF_BUCKET in wrangler." }, 500);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 400);
    }

    const body = await request.json();
    const generatedHtml = String(body?.generatedHtml || "").trim();
    if (!generatedHtml) {
      return jsonResponse({ success: false, error: "generatedHtml is required." }, 400);
    }

    const brandUrl = String(body?.brandUrl || "").trim();
    const magnetType = String(body?.magnetType || "guide").trim().toLowerCase();
    const customerId = String(body?.customerId || "").trim();
    const generationId = body?.generationId ? Number(body.generationId) : null;
    const force = Boolean(body?.force);

    if (!force && env.DB && generationId) {
      const existing = await findExistingPdf(env, generationId);
      if (existing?.pdfKey) {
        return jsonResponse({
          success: true,
          pdfUrl: `/api/pdf?key=${encodeURIComponent(existing.pdfKey)}`,
          pdfKey: existing.pdfKey,
          html: generatedHtml,
          generationId,
          reused: true
        });
      }
    }

    const documentTitle = `${titleize(magnetType)} for ${brandUrl || "your brand"}`;
    const standaloneHtml = toStandaloneHtmlDocument({ documentTitle, generatedHtml, magnetType, brandUrl });
    const renderResult = await requestBrowserRenderingPdf({ env, html: standaloneHtml });
    const pdfBytes = renderResult.bytes;
    const pdfKey = buildPdfKey({ customerId, brandUrl, magnetType });

    await env.PDF_BUCKET.put(pdfKey, pdfBytes, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: `inline; filename="${pdfKey.split("/").pop()}"`
      }
    });

    if (env.DB && generationId) {
      await persistPdfMetadata(env.DB, generationId, { pdfKey });
    }

    return jsonResponse({
      success: true,
      pdfUrl: `/api/pdf?key=${encodeURIComponent(pdfKey)}`,
      pdfKey,
      html: generatedHtml,
      generationId,
      reused: false
    });
  } catch (error) {
    const status = error?.code === "BROWSER_AUTH_FAILED" ? 401 : error?.code?.startsWith("BROWSER") ? 500 : 502;
    return jsonResponse(toPreviewErrorResponse(error, "PDF_RENDER_FAILED"), status);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function findExistingPdf(env, generationId) {
  const info = await env.DB.prepare("PRAGMA table_info(generations)").all();
  const columns = new Set((info?.results || []).map((column) => column.name));
  if (!columns.has("pdf_key")) return null;

  const row = await env.DB
    .prepare("SELECT pdf_key FROM generations WHERE id = ? LIMIT 1")
    .bind(generationId)
    .first();

  if (!row?.pdf_key) return null;
  const object = await env.PDF_BUCKET.head(row.pdf_key);
  if (!object) return null;

  return { pdfKey: row.pdf_key };
}

async function persistPdfMetadata(db, generationId, payload) {
  const info = await db.prepare("PRAGMA table_info(generations)").all();
  const columns = new Set((info?.results || []).map((column) => column.name));
  const nowIso = new Date().toISOString();

  const updates = [];
  const values = [];

  if (columns.has("pdf_key")) {
    updates.push("pdf_key = ?");
    values.push(payload.pdfKey);
  }
  if (columns.has("pdf_created_at")) {
    updates.push("pdf_created_at = ?");
    values.push(nowIso);
  }

  if (!updates.length) return;

  await db
    .prepare(
      `UPDATE generations
       SET ${updates.join(", ")}
       WHERE id = ?`
    )
    .bind(...values, generationId)
    .run();
}

function toStandaloneHtmlDocument({ documentTitle, generatedHtml, magnetType, brandUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <meta name="description" content="Generated ${escapeHtml(titleize(magnetType))} for ${escapeHtml(brandUrl || "your brand")}" />
    <style>
      @page { size: Letter; margin: 0.55in; }
      body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #fff; color: #0f172a; margin: 0; padding: 0; }
      .document-shell { max-width: 8.5in; margin: 0 auto; padding: 0.4in; }
      h1,h2,h3 { color: #0f172a; margin: 0 0 14px; line-height: 1.25; }
      h1 { font-size: 30px; letter-spacing: -0.02em; }
      h2 { font-size: 20px; }
      h3 { font-size: 16px; }
      p,li { font-size: 12.5px; line-height: 1.62; color: #334155; }
      ul,ol { padding-left: 20px; }
    </style>
  </head>
  <body>
    <article class="document-shell">${generatedHtml}</article>
  </body>
</html>`;
}

function titleize(value = "") {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Guide";
}

function buildPdfKey({ customerId, brandUrl, magnetType }) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  const brandPart = slugify(brandUrl || "lead-magnet");
  const customerPart = slugify(customerId || "guest");
  const typePart = slugify(magnetType || "guide");
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `exports/${customerPart}/${dateStamp}/${brandPart}-${typePart}-${randomPart}.pdf`;
}

function slugify(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "document";
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}
