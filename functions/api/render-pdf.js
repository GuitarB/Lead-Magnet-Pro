import puppeteer from "@cloudflare/puppeteer";

export async function onRequestPost(context) {
  const { request, env } = context;
  const requestId = crypto.randomUUID();
  console.log("[render-pdf] start", { requestId });

  try {
    if (!env.BROWSER) {
      throw new Error("Missing BROWSER binding.");
    }
    if (!env.PDF_BUCKET) {
      throw new Error("Missing PDF_BUCKET binding.");
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 400);
    }

    const body = await request.json();
    const { html = "", brandUrl = "", magnetType = "guide" } = body || {};
    if (!String(html).trim()) {
      return jsonResponse({ success: false, error: "Missing HTML payload for PDF rendering." }, 400);
    }

    const wrappedHtml = buildPdfHtml({ html, brandUrl, magnetType });

    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();

    try {
      await page.setViewport({ width: 1240, height: 1754 });
      await page.setContent(wrappedHtml, { waitUntil: "networkidle0" });

      const previewPages = await page.evaluate(() => {
        const PAGE_HEIGHT_PX = 1122;
        const bodyHeight = document.body.scrollHeight;
        const totalPages = Math.max(1, Math.ceil(bodyHeight / PAGE_HEIGHT_PX));
        const headings = Array.from(document.querySelectorAll("h1, h2, h3")).map((node) => ({
          text: node.textContent?.trim() || "",
          top: node.getBoundingClientRect().top + window.scrollY
        }));

        return Array.from({ length: totalPages }).map((_, index) => {
          const start = index * PAGE_HEIGHT_PX;
          const end = (index + 1) * PAGE_HEIGHT_PX;
          const firstHeading = headings.find((heading) => heading.top >= start && heading.top < end)?.text;
          return {
            pageNumber: index + 1,
            title: firstHeading || `Page ${index + 1}`
          };
        });
      });

      const pdfBytes = await page.pdf({
        format: "A4",
        printBackground: true,
        margin: { top: "0.55in", right: "0.55in", bottom: "0.55in", left: "0.55in" }
      });

      const pdfKey = `${Date.now()}-${crypto.randomUUID()}.pdf`;
      console.log("[render-pdf] upload-start", { requestId, pdfKey });

      await env.PDF_BUCKET.put(pdfKey, pdfBytes, {
        httpMetadata: { contentType: "application/pdf" }
      });

      const origin = new URL(request.url).origin;
      const pdfUrl = `${origin}/api/pdf/${encodeURIComponent(pdfKey)}`;
      const pageCount = previewPages.length;
      console.log("[render-pdf] success", { requestId, pdfKey, pageCount, pdfUrl });

      return jsonResponse({
        success: true,
        pdfUrl,
        pdfKey,
        pageCount,
        previewPages
      });
    } finally {
      await page.close();
      await browser.close();
    }
  } catch (error) {
    console.error("[render-pdf] failed", {
      requestId,
      error: error instanceof Error ? error.message : String(error)
    });
    return jsonResponse(
      {
        success: false,
        error: "PDF rendering failed.",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

function buildPdfHtml({ html, brandUrl, magnetType }) {
  const safeBrand = escapeHtml(brandUrl || "your brand");
  const safeFormat = escapeHtml(titleize(magnetType || "guide"));
  const generatedOn = new Date().toISOString().slice(0, 10);

  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${safeFormat} for ${safeBrand}</title>
  <style>
    body { font-family: Inter, system-ui, -apple-system, sans-serif; color: #0f172a; margin: 0; padding: 0; }
    .document-shell { max-width: 860px; margin: 0 auto; padding: 2rem; }
    .meta { margin-bottom: 1.2rem; padding-bottom: 0.9rem; border-bottom: 1px solid #e2e8f0; }
    .meta p { margin: 0.3rem 0; color: #475569; font-size: 12px; }
    h1,h2,h3 { color: #0f172a; }
    p,li { color: #334155; line-height: 1.75; }
  </style>
</head>
<body>
  <article class="document-shell">
    <div class="meta">
      <p><strong>Lead-Magnet Pro deliverable</strong></p>
      <p>Source: ${safeBrand}</p>
      <p>Format: ${safeFormat}</p>
      <p>Generated: ${generatedOn}</p>
    </div>
    ${html}
  </article>
</body>
</html>`;
}

function titleize(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  };
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
