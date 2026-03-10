export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.PDF_BUCKET) {
      return jsonResponse({ success: false, error: "Missing PDF_BUCKET binding." }, 500);
    }

    if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
      return jsonResponse({ success: false, error: "Missing Cloudflare Browser Rendering secrets." }, 500);
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

    const documentTitle = `${titleize(magnetType)} for ${brandUrl || "your brand"}`;
    const paginatedDocument = buildPaginatedDocumentModel(generatedHtml);
    const standaloneHtml = toStandaloneHtmlDocument({
      documentTitle,
      paginatedHtml: paginatedDocument.paginatedHtml,
      magnetType,
      brandUrl
    });

    const pdfResponse = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/pdf`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ html: standaloneHtml })
      }
    );

    if (!pdfResponse.ok) {
      return jsonResponse(
        {
          success: false,
          error: "Cloudflare Browser Rendering PDF request failed.",
          details: await pdfResponse.text()
        },
        502
      );
    }

    const pdfBytes = await pdfResponse.arrayBuffer();
    const pdfKey = buildPdfKey({ customerId, brandUrl, magnetType });
    await env.PDF_BUCKET.put(pdfKey, pdfBytes, {
      httpMetadata: {
        contentType: "application/pdf",
        contentDisposition: `inline; filename="${pdfKey.split("/").pop()}"`
      }
    });

    if (env.DB && generationId) {
      await persistPdfMetadata(env.DB, generationId, pdfKey);
    }

    return jsonResponse({
      success: true,
      pdfUrl: `/api/pdf?key=${encodeURIComponent(pdfKey)}`,
      pdfKey,
      pageCount: paginatedDocument.previewPages.length,
      previewPages: paginatedDocument.previewPages,
      html: generatedHtml,
      generationId
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: "Failed to render PDF.",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function persistPdfMetadata(db, generationId, pdfKey) {
  const info = await db.prepare("PRAGMA table_info(generations)").all();
  const columns = new Set((info?.results || []).map((column) => column.name));
  if (!columns.has("pdf_key") || !columns.has("pdf_created_at")) return;

  const nowIso = new Date().toISOString();
  await db
    .prepare(
      `UPDATE generations
       SET pdf_key = ?, pdf_created_at = ?
       WHERE id = ?`
    )
    .bind(pdfKey, nowIso, generationId)
    .run();
}

function buildPdfKey({ customerId, brandUrl, magnetType }) {
  const idPart = customerId || "public";
  const brandPart = slugify(brandUrl || "lead-magnet");
  const typePart = slugify(magnetType || "guide");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `pdf/${idPart}/${brandPart}-${typePart}-${timestamp}.pdf`;
}

function buildPaginatedDocumentModel(html) {
  const blocks = extractContentBlocks(html);
  const maxPageWeight = 2200;
  const pages = [];

  let currentPageBlocks = [];
  let currentWeight = 0;

  blocks.forEach((block) => {
    const blockWeight = estimateBlockWeight(block);
    const shouldStartNewPage = currentPageBlocks.length > 0 && currentWeight + blockWeight > maxPageWeight;
    if (shouldStartNewPage) {
      pages.push(currentPageBlocks.join(""));
      currentPageBlocks = [];
      currentWeight = 0;
    }

    currentPageBlocks.push(block);
    currentWeight += blockWeight;
  });

  if (currentPageBlocks.length) {
    pages.push(currentPageBlocks.join(""));
  }

  const safePages = pages.length ? pages : [html];
  const previewPages = safePages.map((pageHtml, index) => {
    const plainText = pageHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      page: index + 1,
      html: pageHtml,
      summary: plainText.slice(0, 220)
    };
  });

  const paginatedHtml = previewPages
    .map(
      (page) => `<section class="pdf-page"><div class="pdf-page-inner">${page.html}</div></section>`
    )
    .join("\n");

  return { previewPages, paginatedHtml };
}

function extractContentBlocks(html) {
  const matches = html.match(/<(section|div|h1|h2|h3|h4|p|ul|ol|blockquote|table)[^>]*>[\s\S]*?<\/\1>/gi);
  if (matches?.length) return matches.map((part) => part.trim()).filter(Boolean);
  return [String(html || "").trim()];
}

function estimateBlockWeight(blockHtml) {
  const textLength = blockHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const headingBonus = /<h[1-3][^>]*>/i.test(blockHtml) ? 280 : 0;
  const listBonus = /<(ul|ol)[^>]*>/i.test(blockHtml) ? 220 : 0;
  return textLength + headingBonus + listBonus;
}

function toStandaloneHtmlDocument({ documentTitle, paginatedHtml, magnetType, brandUrl }) {
  const dateStamp = new Date().toISOString().slice(0, 10);
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <meta name="description" content="Generated ${escapeHtml(titleize(magnetType))} for ${escapeHtml(brandUrl || "your brand")}" />
    <style>
      body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 1rem; }
      .document-shell { max-width: 860px; margin: 0 auto; }
      .pdf-page { page-break-after: always; break-after: page; margin: 0 auto 1rem; background: #fff; border: 1px solid #e2e8f0; border-radius: 18px; box-shadow: 0 12px 34px rgba(15,23,42,.09); min-height: 10.2in; overflow: hidden; }
      .pdf-page:last-child { page-break-after: auto; break-after: auto; }
      .pdf-page-inner { padding: 2.2rem; }
      h1,h2,h3 { color: #0f172a; }
      p,li { color: #334155; line-height: 1.75; }
      .export-meta { margin-bottom: 1.4rem; padding-bottom: 1rem; border-bottom: 1px solid #e2e8f0; }
      @page { margin: 0.55in; }
      @media print {
        body { background: #fff; padding: 0; }
        .pdf-page { margin: 0; border: none; border-radius: 0; box-shadow: none; min-height: auto; }
        .pdf-page-inner { padding: 0; }
      }
    </style>
  </head>
  <body>
    <article class="document-shell">
      <div class="export-meta">
        <p style="margin:0;font-size:11px;letter-spacing:0.16em;text-transform:uppercase;color:#475569;">Lead-Magnet Pro deliverable</p>
        <h1 style="margin:6px 0 0;font-size:20px;line-height:1.25;">${escapeHtml(documentTitle)}</h1>
        <p style="margin:6px 0 0;font-size:12px;color:#334155;">Generated ${dateStamp} · Format: ${escapeHtml(titleize(magnetType))}</p>
      </div>
      ${paginatedHtml}
    </article>
  </body>
</html>`;
}

function titleize(value) {
  const text = String(value || "");
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Guide";
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lead-magnet";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
