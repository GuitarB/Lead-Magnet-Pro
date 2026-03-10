import puppeteer from "@cloudflare/puppeteer";
import { buildPreviewPages, renderPdfTemplate } from "../lib/pdf-template.js";

export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    if (!env.BROWSER) return jsonResponse({ success: false, error: "Missing BROWSER binding." }, 500);
    if (!env.PDF_BUCKET) return jsonResponse({ success: false, error: "Missing PDF_BUCKET binding." }, 500);

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 400);
    }

    const body = await request.json();
    const {
      title = "Lead Magnet",
      sourceUrl = "",
      leadMagnetType = "guide",
      audience = "",
      primaryGoal = "",
      generatedHtml = "",
      workspaceName = "",
      customerId = "",
      generationCreatedAt = ""
    } = body || {};

    if (!generatedHtml?.trim()) {
      return jsonResponse({ success: false, error: "generatedHtml is required." }, 400);
    }

    const html = renderPdfTemplate({
      title,
      sourceUrl,
      leadMagnetType,
      audience,
      primaryGoal,
      generatedHtml,
      workspaceName,
      customerId
    });

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "0.6in", right: "0.55in", bottom: "0.7in", left: "0.55in" }
    });
    await browser.close();

    const pdfKey = buildPdfKey({ customerId, leadMagnetType, title });
    await env.PDF_BUCKET.put(pdfKey, pdfBuffer, {
      httpMetadata: { contentType: "application/pdf", contentDisposition: `inline; filename="${sanitizeFilename(title)}.pdf"` }
    });

    if (env.DB && customerId && generationCreatedAt) {
      await env.DB
        .prepare(
          `UPDATE generations
           SET pdf_key = ?, pdf_created_at = ?
           WHERE stripe_customer_id = ? AND created_at = ?`
        )
        .bind(pdfKey, new Date().toISOString(), customerId, generationCreatedAt)
        .run();
    }

    const previewPages = buildPreviewPages(generatedHtml);

    return jsonResponse({
      success: true,
      pdfKey,
      pdfUrl: `/api/pdf?key=${encodeURIComponent(pdfKey)}`,
      pageCount: previewPages.length,
      previewPages
    });
  } catch (error) {
    return jsonResponse(
      { success: false, error: "Failed to render PDF.", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders("POST, OPTIONS") });
}

function buildPdfKey({ customerId = "anon", leadMagnetType = "guide", title = "lead-magnet" }) {
  const now = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const safeTitle = sanitizeFilename(title);
  return `${sanitizeFilename(customerId)}/${leadMagnetType}/${now}-${safeTitle}.pdf`;
}

function sanitizeFilename(value = "file") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "lead-magnet";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders("POST, OPTIONS") }
  });
}

function corsHeaders(methods) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
