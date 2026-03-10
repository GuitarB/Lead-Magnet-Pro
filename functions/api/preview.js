export async function onRequestPost(context) {
  try {
    const { request } = context;
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 400);
    }

    const body = await request.json();
    const generatedHtml = String(body?.generatedHtml || body?.html || "").trim();
    if (!generatedHtml) {
      return jsonResponse({ success: false, error: "generatedHtml is required." }, 400);
    }

    const pages = paginatePreviewHtml(generatedHtml);
    return jsonResponse({
      success: true,
      generationId: body?.generationId || null,
      previewPages: pages,
      pageCount: pages.length
    });
  } catch (error) {
    return jsonResponse({ success: false, error: "Preview generation failed.", details: error instanceof Error ? error.message : String(error) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

function paginatePreviewHtml(html = "") {
  const clean = String(html).replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, "").trim();
  if (!clean) return [];

  const chunks = clean
    .split(/(?=<h1|<h2|<h3|<section|<article|<div class=\"callout\")/i)
    .map((part) => part.trim())
    .filter(Boolean);

  const maxChars = 4500;
  const pages = [];
  let current = "";

  for (const chunk of (chunks.length ? chunks : [clean])) {
    const next = `${current}\n${chunk}`.trim();
    const textLen = stripHtml(next).length;
    if (textLen > maxChars && current) {
      pages.push(current);
      current = chunk;
    } else {
      current = next;
    }
  }
  if (current) pages.push(current);

  return pages
    .map((pageHtml, index) => ({
      page: index + 1,
      html: `<div class="page"><div class="generated-html">${pageHtml}</div></div>`
    }))
    .filter((page) => stripHtml(page.html).length > 0);
}

function stripHtml(input = "") {
  return String(input).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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
