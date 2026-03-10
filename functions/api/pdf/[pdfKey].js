export async function onRequestGet({ params, env }) {
  const rawKey = params?.pdfKey;
  const pdfKey = decodeURIComponent(rawKey || "");

  if (!pdfKey) {
    return new Response("Missing PDF key.", { status: 400 });
  }

  const object = await env.PDF_BUCKET.get(pdfKey);
  if (!object) {
    return new Response("PDF not found.", { status: 404 });
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=3600");
  headers.set("content-disposition", `inline; filename="${pdfKey}"`);

  return new Response(object.body, { headers });
}
