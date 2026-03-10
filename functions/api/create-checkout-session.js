const STRIPE_API_URL = "https://api.stripe.com/v1/checkout/sessions";

const PLAN_CONFIG = {
  starter: { envKey: "STRIPE_PRICE_STARTER", label: "Starter" },
  builder: { envKey: "STRIPE_PRICE_BUILDER", label: "Builder" },
  founder: { envKey: "STRIPE_PRICE_FOUNDER", label: "Founder" }
};

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

    const customerId = typeof body?.customerId === "string" ? body.customerId.trim() : "";

    const selectedPlan = String(body?.plan || "").toLowerCase();
    if (!PLAN_CONFIG[selectedPlan]) {
      return jsonResponse({ success: false, error: "Please choose a paid plan." }, 400);
    }

    const stripeSecretKey = env.STRIPE_SECRET_KEY;
    if (!stripeSecretKey) {
      return jsonResponse({ success: false, error: "Stripe is not configured" }, 500);
    }

    const priceId = env[PLAN_CONFIG[selectedPlan].envKey];
    if (!priceId) {
      return jsonResponse({ success: false, error: `Missing ${PLAN_CONFIG[selectedPlan].envKey}` }, 500);
    }

    const siteUrl = env.SITE_URL || new URL(request.url).origin;
    const formData = new URLSearchParams();

    formData.set("mode", "subscription");
    formData.set("success_url", `${siteUrl}/?payment=success&session_id={CHECKOUT_SESSION_ID}`);
    formData.set("cancel_url", `${siteUrl}/?payment=cancelled`);
    formData.set("line_items[0][quantity]", "1");
    formData.set("line_items[0][price]", priceId);
    formData.set("metadata[plan]", selectedPlan);
    formData.set("subscription_data[metadata][plan]", selectedPlan);

    if (customerId) {
      formData.set("customer", customerId);
    }

    if (!customerId && body && typeof body.email === "string" && body.email.trim()) {
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
