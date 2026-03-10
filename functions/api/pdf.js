export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    if (!env.PDF_BUCKET) {
      return jsonResponse({ success: false, error: "Missing PDF_BUCKET binding." }, 500);
    }

    const { searchParams } = new URL(request.url);
    const key = searchParams.get("key") || "";
    const download = searchParams.get("download") === "1";

    if (!key) return jsonResponse({ success: false, error: "Missing key query parameter." }, 400);

    const object = await env.PDF_BUCKET.get(key);
    if (!object) return jsonResponse({ success: false, error: "PDF not found." }, 404);

    const filename = key.split("/").pop() || "lead-magnet.pdf";
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("Content-Type", "application/pdf");
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    return jsonResponse(
      { success: false, error: "Unable to retrieve PDF.", details: error instanceof Error ? error.message : String(error) },
      500
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
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
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
