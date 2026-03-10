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

    const documentTitle = `${titleize(magnetType)} for ${brandUrl || "your brand"}`;
    const paginatedDocument = buildPaginatedDocumentModel({ html: generatedHtml, brandUrl, magnetType, documentTitle });
    const standaloneHtml = toStandaloneHtmlDocument({
      documentTitle,
      paginatedHtml: paginatedDocument.paginatedHtml,
      magnetType,
      brandUrl
    });

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
      await persistPdfMetadata(env.DB, generationId, { pdfKey, previewPages: paginatedDocument.previewPages });
    }

    console.log(`[preview] preview render succeeded: ${paginatedDocument.previewPages.length} pages`);

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
    const status = error?.code === "BROWSER_AUTH_FAILED" ? 401 : error?.code?.startsWith("BROWSER") ? 500 : 502;
    return jsonResponse(toPreviewErrorResponse(error, "PREVIEW_RENDER_FAILED"), status);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
  if (columns.has("preview_pages_json")) {
    updates.push("preview_pages_json = ?");
    values.push(JSON.stringify(payload.previewPages || []));
  }
  if (columns.has("preview_page_count")) {
    updates.push("preview_page_count = ?");
    values.push(Array.isArray(payload.previewPages) ? payload.previewPages.length : 0);
  }
  if (columns.has("preview_updated_at")) {
    updates.push("preview_updated_at = ?");
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

function buildPaginatedDocumentModel({ html, brandUrl, magnetType, documentTitle }) {
  const cleanHtml = stripUnsafeTags(html);
  const blocks = extractBlocks(cleanHtml);
  const sectionBlocks = groupSections(blocks);
  const pages = paginateSections(sectionBlocks, magnetType);

  if (!pages.length) {
    pages.push([`<section class="lm-section"><h2>Lead Magnet</h2><p>${escapeHtml(documentTitle)}</p></section>`]);
  }

  pages[0] = [buildCover({ documentTitle, brandUrl, magnetType }), ...pages[0]];
  const totalPages = pages.length;

  const previewPages = pages.map((blocksForPage, index) => {
    const pageBody = blocksForPage.join("\n");
    const wrappedPageHtml = toPageMarkup(pageBody, index + 1, totalPages);
    const plainText = pageBody.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return {
      page: index + 1,
      html: wrappedPageHtml,
      summary: plainText.slice(0, 240)
    };
  });

  const paginatedHtml = previewPages.map((page) => page.html).join("\n");
  return { previewPages, paginatedHtml };
}

function toPageMarkup(pageBodyHtml, pageNumber, totalPages) {
  return `<section class="pdf-page"><div class="pdf-page-inner">${pageBodyHtml}</div><footer class="page-footer"><span>Lead-Magnet Pro</span><span>Page ${pageNumber} of ${totalPages}</span></footer></section>`;
}

function stripUnsafeTags(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "")
    .trim();
}

function extractBlocks(html) {
  const matches = html.match(/<(section|div|h1|h2|h3|h4|p|ul|ol|blockquote|table)[^>]*>[\s\S]*?<\/\1>/gi);
  if (matches?.length) return matches.map((part) => part.trim()).filter(Boolean);
  if (!html) return [];
  return html
    .split(/\n\s*\n/g)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => (chunk.startsWith("<") ? chunk : `<p>${escapeHtml(chunk)}</p>`));
}

function groupSections(blocks) {
  const sections = [];
  let current = [];

  blocks.forEach((block) => {
    const isHeading = /<h[1-3][^>]*>/i.test(block);
    if (isHeading && current.length) {
      sections.push(current);
      current = [];
    }
    current.push(ensureSectionWrapper(block));
  });

  if (current.length) sections.push(current);
  return sections;
}

function ensureSectionWrapper(blockHtml) {
  if (/^<section\b/i.test(blockHtml)) {
    return blockHtml.includes("lm-section") ? blockHtml : blockHtml.replace(/^<section\b([^>]*)>/i, '<section class="lm-section"$1>');
  }
  return `<section class="lm-section">${blockHtml}</section>`;
}

function paginateSections(sections, magnetType) {
  const baseBudget = magnetType === "checklist" ? 2400 : magnetType === "ebook" ? 3000 : 2600;
  const pages = [];
  let currentPage = [];
  let currentWeight = 0;

  sections.forEach((section) => {
    const sectionWeight = section.reduce((sum, block) => sum + estimateWeight(block), 0);
    if (sectionWeight > baseBudget * 0.9) {
      section.forEach((block) => {
        const blockWeight = estimateWeight(block);
        if (currentPage.length && currentWeight + blockWeight > baseBudget) {
          pages.push(currentPage);
          currentPage = [];
          currentWeight = 0;
        }
        currentPage.push(block);
        currentWeight += blockWeight;
      });
      return;
    }

    if (currentPage.length && currentWeight + sectionWeight > baseBudget) {
      pages.push(currentPage);
      currentPage = [];
      currentWeight = 0;
    }

    currentPage.push(...section);
    currentWeight += sectionWeight;
  });

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function estimateWeight(blockHtml) {
  const textLength = blockHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;
  const headingBonus = /<h[1-3][^>]*>/i.test(blockHtml) ? 220 : 0;
  const listBonus = /<(ul|ol)[^>]*>/i.test(blockHtml) ? 260 : 0;
  const calloutBonus = /(takeaway|implementation|note|cta|tip)/i.test(blockHtml) ? 180 : 0;
  return Math.max(120, textLength + headingBonus + listBonus + calloutBonus);
}

function buildCover({ documentTitle, brandUrl, magnetType }) {
  return `<section class="cover-panel lm-section"><p class="cover-kicker">Lead-Magnet Pro</p><h1>${escapeHtml(documentTitle)}</h1><p class="cover-subtitle">A polished ${escapeHtml(titleize(magnetType))} crafted for ${escapeHtml(brandUrl || "your business")}.</p><p class="cover-meta">Generated ${new Date().toISOString().slice(0, 10)}</p></section>`;
}

function toStandaloneHtmlDocument({ documentTitle, paginatedHtml, magnetType, brandUrl }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(documentTitle)}</title>
    <meta name="description" content="Generated ${escapeHtml(titleize(magnetType))} for ${escapeHtml(brandUrl || "your brand")}" />
    <style>
      @page { size: Letter; margin: 0.55in; }
      body { font-family: Inter, system-ui, -apple-system, sans-serif; background: #eef2f7; color: #0f172a; margin: 0; padding: 0.4in 0; }
      .document-shell { max-width: 8.5in; margin: 0 auto; }
      .pdf-page { background: #fff; margin: 0 auto 0.18in; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.12); min-height: 10.9in; display:flex; flex-direction:column; }
      .pdf-page-inner { padding: 0.6in 0.58in 0.32in; flex:1; }
      .page-footer { border-top: 1px solid #e2e8f0; color: #64748b; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; display:flex; justify-content:space-between; padding: 0.12in 0.58in 0.18in; }
      .lm-section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 0.2in; }
      h1,h2,h3 { color: #0f172a; margin: 0 0 .12in; line-height: 1.25; break-after: avoid-page; page-break-after: avoid; }
      h1 { font-size: 30px; letter-spacing: -0.02em; }
      h2 { font-size: 20px; }
      h3 { font-size: 16px; }
      p,li { font-size: 12.5px; line-height: 1.62; color: #334155; orphans: 3; widows: 3; }
      ul,ol,blockquote,table { break-inside: avoid; page-break-inside: avoid; margin: .07in 0 .16in; }
      ul,ol { padding-left: .22in; }
      li { margin: 0 0 .06in; }
      blockquote { border-left: 3px solid #cbd5e1; padding-left: .12in; color: #1e293b; }
      .cover-panel { background: linear-gradient(145deg, #eef2ff, #ecfeff); border: 1px solid #c7d2fe; border-radius: 16px; padding: 0.35in; margin-bottom: 0.28in; }
      .cover-kicker { margin: 0; font-size: 10px; letter-spacing: .22em; text-transform: uppercase; color: #4338ca; font-weight: 700; }
      .cover-subtitle { font-size: 13px; color: #1e293b; margin-top: .08in; }
      .cover-meta { margin-top: .12in; font-size: 11px; color: #475569; }
      @media print {
        body { background: #fff; padding: 0; }
        .pdf-page { margin: 0; box-shadow: none; min-height: auto; break-after: page; page-break-after: always; }
        .pdf-page:last-child { break-after: auto; page-break-after: auto; }
      }
    </style>
  </head>
  <body>
    <article class="document-shell">${paginatedHtml}</article>
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

function buildPdfKey({ customerId, brandUrl, magnetType }) {
  const idPart = customerId || "public";
  const brandPart = slugify(brandUrl || "lead-magnet");
  const typePart = slugify(magnetType || "guide");
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `pdf/${idPart}/${brandPart}-${typePart}-${timestamp}.pdf`;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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
