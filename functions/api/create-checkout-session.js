const STRIPE_API_URL = "https://api.stripe.com/v1/checkout/sessions";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}

export async function onRequest(context) {
  if (context.request.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const { request, env } = context;
    const body = await request.json().catch(() => ({}));

    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return jsonResponse({ success: false, error: "Stripe is not configured" }, 500);
    }

    const amount = Number.parseInt(env.STRIPE_PRICE_AMOUNT || "900", 10);
    const currency = (env.STRIPE_CURRENCY || "usd").toLowerCase();
    const siteUrl = env.SITE_URL || new URL(request.url).origin;

    const formData = new URLSearchParams();
    formData.set("mode", "payment");
    formData.set("success_url", `${siteUrl}/?payment=success`);
    formData.set("cancel_url", `${siteUrl}/?payment=cancelled`);
    formData.set("line_items[0][quantity]", "1");
    formData.set("line_items[0][price_data][currency]", currency);
    formData.set("line_items[0][price_data][unit_amount]", String(Number.isFinite(amount) ? amount : 900));
    formData.set("line_items[0][price_data][product_data][name]", "Lead-Magnet Pro");

    if (body && typeof body.email === "string" && body.email.trim()) {
      formData.set("customer_email", body.email.trim());
    }

    const stripeResponse = await fetch(STRIPE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: formData.toString()
    });

    const stripeResult = await stripeResponse.json();

    if (!stripeResponse.ok || !stripeResult.url) {
      const stripeError = stripeResult?.error?.message || "Unable to create checkout session";
      return jsonResponse({ success: false, error: stripeError }, 400);
    }

    return jsonResponse({ success: true, url: stripeResult.url });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unexpected error creating checkout session"
      },
      500
    );
  }
}
