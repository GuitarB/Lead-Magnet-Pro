export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    if (!env.PDF_BUCKET) {
      return jsonResponse({ success: false, error: "Missing PDF_BUCKET binding." }, 500);
    }

    const url = new URL(request.url);
    const key = (url.searchParams.get("key") || "").trim();
    if (!key) {
      return jsonResponse({ success: false, error: "Missing PDF key." }, 400);
    }

    const object = await env.PDF_BUCKET.get(key);
    if (!object) {
      return jsonResponse({ success: false, error: "PDF not found." }, 404);
    }

    const disposition = url.searchParams.get("download") === "1" ? "attachment" : "inline";
    const filename = key.split("/").pop() || "document.pdf";

    const headers = new Headers();
    headers.set("Content-Type", object.httpMetadata?.contentType || "application/pdf");
    headers.set("Content-Disposition", `${disposition}; filename="${filename}"`);
    headers.set("Cache-Control", "private, max-age=300");
    headers.set("Access-Control-Allow-Origin", "*");

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Failed to retrieve PDF." },
      500
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
