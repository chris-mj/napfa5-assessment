import { serve } from "https://deno.land/std@0.211.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const { name, email, mobile, message, platformOwnerEmail } = await req.json();

    if (!name || !email || !message || !platformOwnerEmail) {
      return new Response(
        JSON.stringify({ error: "Name, email, and message are required." }),
        {
          status: 400,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
          },
        },
      );
    }

    const apiKey = Deno.env.get("BREVO_API_KEY");
    const senderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
    const senderName = Deno.env.get("BREVO_SENDER_NAME") ?? "NAPFA5 Contact";

    if (!apiKey || !senderEmail) {
      throw new Error("BREVO_API_KEY or BREVO_SENDER_EMAIL is not configured.");
    }

    const subject = `Contact Form Submission from ${name}`;
    const textBody = `Name: ${name}\nEmail: ${email}\nMobile: ${mobile || "-"}\n\nMessage:\n${message}`;

    const payload = {
      sender: { email: senderEmail, name: senderName },
      to: [{ email: platformOwnerEmail }],
      cc: [{ email }],
      subject,
      textContent: textBody,
      replyTo: { email }
    };

    const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(errText || "Failed to send email");
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message || "Unexpected error" }),
      {
        status: 500,
        headers: {
          ...CORS_HEADERS,
          "Content-Type": "application/json",
        },
      },
    );
  }
});