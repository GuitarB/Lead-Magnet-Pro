const PLAN_LIMITS = {
  starter: 20,
  builder: 75,
  founder: 200
};

const FORMAT_GUIDES = {
  ebook: {
    label: "Ebook",
    expectations: [
      "Long-form deliverable with substantial depth and chapter-like structure.",
      "Open with a title-page style cover section containing the asset title, subtitle, and intended audience.",
      "Include a table of contents that links to chapter IDs via anchor links.",
      "Provide at least 6 major sections/chapters with practical examples, frameworks, and action summaries.",
      "Close with a next-steps conclusion and CTA section."
    ]
  },
  guide: {
    label: "Guide",
    expectations: [
      "Medium-length practical instructional resource.",
      "Use clear section headings in a logical sequence from setup to execution.",
      "Include concise takeaways and implementation notes in each section.",
      "Provide a quick-start summary and final action plan."
    ]
  },
  checklist: {
    label: "Checklist",
    expectations: [
      "Highly scannable and concise checklist-style deliverable.",
      "Organize into phases with short action-oriented checklist items.",
      "Use checkbox symbols (☐) in list items for completion tracking.",
      "Minimize long paragraphs; keep sections compact and tactical."
    ]
  },
  worksheet: {
    label: "Worksheet",
    expectations: [
      "Interactive-feeling worksheet with fill-in prompts and exercises.",
      "Use sections with prompts, reflection questions, and answer spaces represented in HTML.",
      "Include multiple mini-exercises and a final synthesis section.",
      "Keep language coach-like and directive so users can complete it immediately."
    ]
  },
  "landing-page-copy": {
    label: "Landing Page Copy",
    expectations: [
      "Conversion-focused landing page copy layout.",
      "Include headline, subheadline, core benefits, objections, offer details, proof elements, and CTA sections.",
      "Provide concise copy blocks suitable for direct placement on a landing page.",
      "Add at least two CTA variants and one urgency/risk-reversal block."
    ]
  },
  "follow-up-email-sequence": {
    label: "Follow-up Email Sequence",
    expectations: [
      "Create a sequence of 5 follow-up emails.",
      "Each email must include: email number, purpose, subject line, preview text, and full body copy.",
      "Vary angle across emails (education, story, objection handling, offer, urgency).",
      "Keep each email skimmable with short paragraphs and clear CTA."
    ]
  },
  "brand-kit-suggestions": {
    label: "Brand Kit Suggestions",
    expectations: [
      "Present structured brand system recommendations.",
      "Include brand voice attributes, messaging pillars, tagline ideas, headline ideas, and tone do/don't examples.",
      "Provide at least three color palette options with hex codes.",
      "Provide font pairing suggestions and logo concept prompts."
    ]
  }
};

export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ success: false, error: "Missing OPENAI_API_KEY environment variable." }, 500);
    }

    const contentType = request.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return jsonResponse({ success: false, error: "Content-Type must be application/json." }, 400);
    }

    const body = await request.json();
    const { brandUrl = "", audience = "", goal = "", magnetType = "guide", plan = "free", customerId = "" } = body || {};

    if (!brandUrl && !audience && !goal) {
      return jsonResponse({ success: false, error: "At least one of brandUrl, audience, or goal is required." }, 400);
    }

    const normalizedPlan = String(plan).toLowerCase();
    const isPaidPlan = Object.hasOwn(PLAN_LIMITS, normalizedPlan);

    if (isPaidPlan) {
      if (!env.DB) {
        return jsonResponse({ success: false, error: "Missing D1 binding (DB) for paid plan usage tracking." }, 500);
      }
      if (!customerId) {
        return jsonResponse({ success: false, error: "Missing customer identifier for paid plan." }, 401);
      }

      const usageCheck = await ensureUnderPlanLimit(env.DB, customerId, normalizedPlan);
      if (!usageCheck.success) {
        return jsonResponse({ success: false, error: usageCheck.error }, usageCheck.status || 400);
      }
    }

    const normalizedMagnetType = normalizeMagnetType(magnetType);
    const formatGuide = getFormatGuide(normalizedMagnetType);

    const systemPrompt = `
You are an elite direct-response marketer, B2B brand strategist, lead generation copywriter, and conversion-focused content architect.

Your job is to create a premium, professional, PDF-ready lead magnet in clean HTML.

The output must:
- Be high-conversion and commercially useful
- Feel premium, polished, and authoritative
- Be tailored to the user's business context
- Be formatted as clean semantic HTML only
- Use simple inline-safe HTML structure that can later be styled or exported to PDF
- Use short paragraphs
- Use clear section headings
- Use bullet points where useful
- Keep paragraphs concise and readable on mobile
- Avoid overly long blocks of text
- Return raw HTML only
- Do not return markdown
- Do not wrap the response in fenced code blocks
- Do not wrap the output in backticks
- Not include explanations before or after the HTML

Selected output format: ${formatGuide.label}
Format-specific requirements:
${formatGuide.expectations.map((item) => `- ${item}`).join("\n")}

The HTML should generally use:
<section>, <div>, <h1>, <h2>, <h3>, <p>, <ul>, <li>, <strong>

Assume the target is a modern premium business lead magnet.
`.trim();

    const userPrompt = `
Create a lead magnet using the following business inputs.

Brand URL:
${brandUrl || "Not provided"}

Target Audience:
${audience || "Not provided"}

Primary Goal:
${goal || "Not provided"}

Lead Magnet Type:
${formatGuide.label}

Return only polished HTML for the lead magnet.
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.8,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ]
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      return jsonResponse({ success: false, error: "OpenAI API request failed.", details: errorText }, 500);
    }

    const data = await openaiResponse.json();
    const generatedHtml = data?.choices?.[0]?.message?.content?.trim() || "";

    if (!generatedHtml) {
      return jsonResponse({ success: false, error: "No content returned from OpenAI." }, 500);
    }

    let savedGeneration = null;
    if (isPaidPlan && env.DB) {
      savedGeneration = await recordUsageAndGeneration(env.DB, {
        customerId,
        plan: normalizedPlan,
        brandUrl,
        audience,
        goal,
        magnetType,
        generatedHtml
      });
    }

    return jsonResponse({
      success: true,
      html: generatedHtml,
      generationId: savedGeneration?.id || null,
      pdfUrl: null,
      pdfKey: null,
      pageCount: 0,
      previewPages: [],
      savedGeneration: savedGeneration
        ? {
            id: savedGeneration.id,
            createdAt: savedGeneration.createdAt,
            plan: savedGeneration.plan,
            magnetType: savedGeneration.magnetType
          }
        : null
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: "Server error while generating lead magnet.",
        details: error instanceof Error ? error.message : String(error)
      },
      500
    );
  }
}

function normalizeMagnetType(value) {
  const normalized = String(value || "guide").trim().toLowerCase();
  return Object.hasOwn(FORMAT_GUIDES, normalized) ? normalized : "guide";
}

function getFormatGuide(magnetType) {
  return FORMAT_GUIDES[magnetType] || FORMAT_GUIDES.guide;
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function ensureUnderPlanLimit(db, customerId, plan) {
  const now = new Date();
  const periodKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const limit = PLAN_LIMITS[plan];

  const subscription = await db
    .prepare(
      `SELECT stripe_subscription_id, status, current_period_end
       FROM subscriptions
       WHERE stripe_customer_id = ? AND plan = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(customerId, plan)
    .first();

  if (!subscription || !["active", "trialing"].includes(subscription.status)) {
    return { success: false, status: 403, error: `No active ${plan} subscription found.` };
  }

  if (subscription.current_period_end && subscription.current_period_end < now.toISOString()) {
    return { success: false, status: 403, error: "Subscription period has ended." };
  }

  const usageRow = await db
    .prepare(`SELECT generation_count FROM usage WHERE stripe_customer_id = ? AND period_key = ?`)
    .bind(customerId, periodKey)
    .first();

  if ((usageRow?.generation_count || 0) >= limit) {
    return { success: false, status: 429, error: `Monthly limit reached for ${plan} (${limit} generations).` };
  }

  return { success: true, periodKey };
}

async function recordUsageAndGeneration(db, generation) {
  const nowIso = new Date().toISOString();
  const periodKey = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}`;

  await db
    .prepare(
      `INSERT INTO usage (stripe_customer_id, period_key, generation_count, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?)
       ON CONFLICT(stripe_customer_id, period_key) DO NOTHING`
    )
    .bind(generation.customerId, periodKey, nowIso, nowIso)
    .run();

  await db
    .prepare(
      `UPDATE usage
       SET generation_count = generation_count + 1, updated_at = ?
       WHERE stripe_customer_id = ? AND period_key = ?`
    )
    .bind(nowIso, generation.customerId, periodKey)
    .run();

  const subscription = await db
    .prepare(
      `SELECT stripe_subscription_id
       FROM subscriptions
       WHERE stripe_customer_id = ? AND plan = ?
       ORDER BY updated_at DESC
       LIMIT 1`
    )
    .bind(generation.customerId, generation.plan)
    .first();

  const insertResult = await db
    .prepare(
      `INSERT INTO generations (
        stripe_customer_id,
        stripe_subscription_id,
        plan,
        brand_url,
        audience,
        goal,
        magnet_type,
        generated_html,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      generation.customerId,
      subscription?.stripe_subscription_id || null,
      generation.plan,
      generation.brandUrl,
      generation.audience,
      generation.goal,
      generation.magnetType,
      generation.generatedHtml,
      nowIso
    )
    .run();

  return {
    id: insertResult?.meta?.last_row_id || null,
    createdAt: nowIso,
    plan: generation.plan,
    magnetType: generation.magnetType
  };
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
