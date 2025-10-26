// api/createUser.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    // Always include CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
        res.status(204).end();
        return;
    }

    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    const { email, password, fullName } = JSON.parse(body || "{}");

    if (!email || !password) {
        res.status(400).json({ error: "Missing fields" });
        return;
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });

    if (error) res.status(400).json({ error: error.message });
    else res.status(200).json({ user_id: data.user.id });
}

