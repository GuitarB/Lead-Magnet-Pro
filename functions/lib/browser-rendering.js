const PREVIEW_ERROR_MESSAGES = {
  BROWSER_RENDERING_NOT_CONFIGURED: "Preview unavailable right now. Browser Rendering is not configured.",
  BROWSER_BINDING_MISSING: "Preview unavailable right now. Browser Rendering is not configured.",
  BROWSER_ACCOUNT_ID_MISSING: "Preview unavailable right now. Browser Rendering is not configured.",
  BROWSER_API_TOKEN_MISSING: "Preview unavailable right now. Browser Rendering is not configured.",
  BROWSER_AUTH_FAILED: "Preview unavailable right now. Browser Rendering credentials were rejected.",
  PREVIEW_RENDER_FAILED: "Preview unavailable right now. We couldn’t connect to the PDF rendering service."
};

export function resolveBrowserRenderingConfig(env = {}) {
  const hasBinding = Boolean(env.BROWSER);
  const hasAccountId = Boolean(env.CLOUDFLARE_ACCOUNT_ID);
  const hasApiToken = Boolean(env.CLOUDFLARE_API_TOKEN);

  if (hasBinding) {
    return {
      available: true,
      mode: "binding",
      missing: []
    };
  }

  const missing = [];
  if (!hasAccountId) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!hasApiToken) missing.push("CLOUDFLARE_API_TOKEN");

  return {
    available: missing.length === 0,
    mode: missing.length === 0 ? "token" : "unconfigured",
    missing
  };
}

export async function requestBrowserRenderingPdf({ env, html }) {
  const config = resolveBrowserRenderingConfig(env);
  if (!config.available) {
    console.error("[preview] missing BROWSER binding");
    if (config.missing.includes("CLOUDFLARE_ACCOUNT_ID")) console.error("[preview] missing CLOUDFLARE_ACCOUNT_ID");
    if (config.missing.includes("CLOUDFLARE_API_TOKEN")) console.error("[preview] missing CLOUDFLARE_API_TOKEN");
    throw createPreviewError("BROWSER_RENDERING_NOT_CONFIGURED", "Browser Rendering credentials are missing.", {
      mode: config.mode,
      missing: config.missing
    });
  }

  const payload = {
    html,
    options: {
      printBackground: true,
      preferCSSPageSize: true
    }
  };

  let response;
  if (config.mode === "binding") {
    if (typeof env.BROWSER.fetch !== "function") {
      console.error("[preview] missing BROWSER binding");
      throw createPreviewError("BROWSER_BINDING_MISSING", "BROWSER binding is present but does not expose fetch().", { mode: config.mode });
    }
    try {
      response = await env.BROWSER.fetch("https://browser-rendering.internal/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error("[preview] browser auth failed", error);
      throw createPreviewError("BROWSER_AUTH_FAILED", error?.message || "Browser binding request failed.", { mode: config.mode });
    }
  } else {
    const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/pdf`;
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  }

  if (!response.ok) {
    const details = await response.text();
    if (response.status === 401 || response.status === 403) {
      console.error("[preview] browser auth failed", { status: response.status, mode: config.mode });
      throw createPreviewError("BROWSER_AUTH_FAILED", details || "Browser Rendering credentials were rejected.", {
        mode: config.mode,
        status: response.status
      });
    }

    throw createPreviewError("PREVIEW_RENDER_FAILED", details || "Browser Rendering PDF request failed.", {
      mode: config.mode,
      status: response.status
    });
  }

  return {
    bytes: await response.arrayBuffer(),
    mode: config.mode
  };
}

export function createPreviewError(code, details, meta = {}) {
  const error = new Error(details || PREVIEW_ERROR_MESSAGES[code] || "Preview build failed.");
  error.code = code;
  error.details = details || "";
  error.meta = meta;
  error.userMessage = PREVIEW_ERROR_MESSAGES[code] || PREVIEW_ERROR_MESSAGES.PREVIEW_RENDER_FAILED;
  return error;
}

export function toPreviewErrorResponse(error, fallbackCode = "PREVIEW_RENDER_FAILED", status = 500) {
  const code = error?.code || fallbackCode;
  return {
    success: false,
    errorCode: code,
    error: PREVIEW_ERROR_MESSAGES[code] || PREVIEW_ERROR_MESSAGES.PREVIEW_RENDER_FAILED,
    userMessage: PREVIEW_ERROR_MESSAGES[code] || PREVIEW_ERROR_MESSAGES.PREVIEW_RENDER_FAILED,
    details: error?.details || error?.message || "Unknown preview error.",
    meta: error?.meta || {}
  };
}
