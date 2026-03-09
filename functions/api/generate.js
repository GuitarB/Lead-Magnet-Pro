export async function onRequestPost(context) {
  try {
    const { request, env } = context;

    if (!env.OPENAI_API_KEY) {
      return jsonResponse(
        {
          success: false,
          error: "Missing OPENAI_API_KEY environment variable."
        },
        500
      );
    }

    const contentType = request.headers.get("content-type") || "";

    if (!contentType.includes("application/json")) {
      return jsonResponse(
        {
          success: false,
          error: "Content-Type must be application/json."
        },
        400
      );
    }

    const body = await request.json();
    const {
      brandUrl = "",
      audience = "",
      goal = "",
      magnetType = "guide"
    } = body || {};

    if (!brandUrl && !audience && !goal) {
      return jsonResponse(
        {
          success: false,
          error: "At least one of brandUrl, audience, or goal is required."
        },
        400
      );
    }

    const systemPrompt = `
You are an elite direct-response marketer, B2B brand strategist, lead generation copywriter, and conversion-focused content architect.

Your job is to create a premium, professional, PDF-ready lead magnet in clean HTML.

The output must:
- Be high-conversion and commercially useful
- Feel premium, polished, and authoritative
- Be tailored to the user's business context
- Be formatted as clean semantic HTML only
- Include a strong headline
- Include a compelling subheadline
- Include an introduction
- Include 5 to 10 actionable sections or steps
- Include a short conclusion
- Include a CTA section
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
${magnetType || "guide"}

Return only polished HTML for the lead magnet.
`.trim();

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: "gpt-4o",
        temperature: 0.8,
        messages: [
          {
            role: "system",
            content: systemPrompt
          },
          {
            role: "user",
            content: userPrompt
          }
        ]
      })
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();

      return jsonResponse(
        {
          success: false,
          error: "OpenAI API request failed.",
          details: errorText
        },
        500
      );
    }

    const data = await openaiResponse.json();
    const generatedHtml =
      data?.choices?.[0]?.message?.content?.trim() || "";

    if (!generatedHtml) {
      return jsonResponse(
        {
          success: false,
          error: "No content returned from OpenAI."
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      html: generatedHtml
    });
  } catch (error) {
    return jsonResponse(
      {
        success: false,
        error: "Server error while generating lead magnet.",
        details: error.message
      },
      500
    );
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
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
