const STRIPE_API_BASE = "https://api.stripe.com/v1";
const PRICE_TO_PLAN = {
  STRIPE_PRICE_STARTER: "starter",
  STRIPE_PRICE_BUILDER: "builder",
  STRIPE_PRICE_FOUNDER: "founder"
};

export async function onRequestGet(context) {
  try {
    const { request, env } = context;
    const stripeSecretKey = env.STRIPE_SECRET_KEY;

    if (!stripeSecretKey) {
      return jsonResponse({ success: false, error: "Stripe is not configured" }, 500);
    }

    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    if (!sessionId) {
      return jsonResponse({ success: false, error: "Missing session_id." }, 400);
    }

    const sessionRes = await fetch(
      `${STRIPE_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=subscription&expand[]=customer`,
      {
        headers: { Authorization: `Bearer ${stripeSecretKey}` }
      }
    );
    const session = await sessionRes.json();

    if (!sessionRes.ok) {
      return jsonResponse({ success: false, error: session?.error?.message || "Unable to verify session." }, 400);
    }

    if (session.mode !== "subscription" || session.payment_status !== "paid") {
      return jsonResponse({ success: false, error: "Checkout session is not paid." }, 400);
    }

    const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const subObj = typeof session.subscription === "object" ? session.subscription : null;

    const plan = resolvePlan(env, session, subObj);

    if (!plan) {
      return jsonResponse({ success: false, error: "Unable to determine subscription plan." }, 400);
    }

    if (env.DB && customerId && subscriptionId && subObj) {
      await persistSubscription(env.DB, {
        customerId,
        customerEmail: session.customer_details?.email || session.customer_email || null,
        subscriptionId,
        plan,
        status: subObj.status || "active",
        currentPeriodStart: toIso(subObj.current_period_start),
        currentPeriodEnd: toIso(subObj.current_period_end),
        cancelAtPeriodEnd: subObj.cancel_at_period_end ? 1 : 0
      });
    }

    return jsonResponse({
      success: true,
      customerId,
      plan,
      status: subObj?.status || "active"
    });
  } catch (error) {
    return jsonResponse(
      { success: false, error: error instanceof Error ? error.message : "Unexpected verification error" },
      500
    );
  }
}

async function persistSubscription(db, payload) {
  const nowIso = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO customers (stripe_customer_id, email, created_at, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(stripe_customer_id) DO UPDATE SET
         email = excluded.email,
         updated_at = excluded.updated_at`
    )
    .bind(payload.customerId, payload.customerEmail, nowIso, nowIso)
    .run();

  await db
    .prepare(
      `INSERT INTO subscriptions (
        stripe_subscription_id,
        stripe_customer_id,
        plan,
        status,
        current_period_start,
        current_period_end,
        cancel_at_period_end,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(stripe_subscription_id) DO UPDATE SET
        plan = excluded.plan,
        status = excluded.status,
        current_period_start = excluded.current_period_start,
        current_period_end = excluded.current_period_end,
        cancel_at_period_end = excluded.cancel_at_period_end,
        updated_at = excluded.updated_at`
    )
    .bind(
      payload.subscriptionId,
      payload.customerId,
      payload.plan,
      payload.status,
      payload.currentPeriodStart,
      payload.currentPeriodEnd,
      payload.cancelAtPeriodEnd,
      nowIso,
      nowIso
    )
    .run();
}

function resolvePlan(env, session, subscription) {
  const metadataPlan = session?.metadata?.plan || subscription?.metadata?.plan;
  if (metadataPlan) {
    return String(metadataPlan).toLowerCase();
  }

  const priceId = subscription?.items?.data?.[0]?.price?.id;
  if (!priceId) {
    return null;
  }

  for (const [envKey, plan] of Object.entries(PRICE_TO_PLAN)) {
    if (env[envKey] === priceId) {
      return plan;
    }
  }

  return null;
}

function toIso(unixSeconds) {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000).toISOString();
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
