const PLAN_LIMITS = {
  free: 1,
  starter: 20,
  builder: 75,
  founder: 200
};

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    if (!env.DB) {
      return jsonResponse({ success: false, error: "Missing D1 binding (DB)." }, 500);
    }

    const { searchParams } = new URL(request.url);
    const email = (searchParams.get("email") || "").trim().toLowerCase();
    if (!email) {
      return jsonResponse({ success: false, error: "Email is required." }, 400);
    }

    const customer = await env.DB
      .prepare(
        `SELECT stripe_customer_id, email
         FROM customers
         WHERE lower(email) = ?
         LIMIT 1`
      )
      .bind(email)
      .first();

    if (!customer?.stripe_customer_id) {
      return jsonResponse({ success: false, error: "Workspace not found." }, 404);
    }

    const subscription = await env.DB
      .prepare(
        `SELECT plan, status, current_period_start, current_period_end
         FROM subscriptions
         WHERE stripe_customer_id = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .bind(customer.stripe_customer_id)
      .first();

    const plan = (subscription?.plan || "free").toLowerCase();
    const now = new Date();
    const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

    const usageRow = await env.DB
      .prepare(
        `SELECT generation_count
         FROM usage
         WHERE stripe_customer_id = ? AND period_key = ?`
      )
      .bind(customer.stripe_customer_id, periodKey)
      .first();

    const generationLimit = PLAN_LIMITS[plan] || PLAN_LIMITS.free;
    const generationsUsed = usageRow?.generation_count || 0;
    const generationsRemaining = Math.max(generationLimit - generationsUsed, 0);

    const rows = await env.DB
      .prepare(
        `SELECT brand_url, magnet_type, generated_html, created_at, pdf_key
         FROM generations
         WHERE stripe_customer_id = ?
         ORDER BY created_at DESC
         LIMIT 8`
      )
      .bind(customer.stripe_customer_id)
      .all();

    const recentGenerations = (rows?.results || []).map((row) => ({
      brandUrl: row.brand_url || "",
      magnetType: row.magnet_type || "guide",
      createdAt: row.created_at,
      generatedHtml: row.generated_html || "",
      pdfKey: row.pdf_key || null,
      pdfUrl: row.pdf_key ? `/api/pdf?key=${encodeURIComponent(row.pdf_key)}` : null,
      plan
    }));

    return jsonResponse({
      success: true,
      customerId: customer.stripe_customer_id,
      email: customer.email,
      plan,
      subscriptionStatus: subscription?.status || "inactive",
      billingPeriodStart: subscription?.current_period_start || null,
      billingPeriodEnd: subscription?.current_period_end || null,
      generationsUsed,
      generationLimit,
      generationsRemaining,
      recentGenerations
    });
  } catch (error) {
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Failed to load workspace." },
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
