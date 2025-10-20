// api/createUser.js
import { createClient } from "@supabase/supabase-js";

const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
    // Vercel passes the request as a standard Node.js HTTP request
    if (req.method !== "POST") {
        res.statusCode = 405;
        res.end(JSON.stringify({ error: "Method not allowed" }));
        return;
    }

    let body = "";
    for await (const chunk of req) body += chunk;
    const { email, password, fullName } = JSON.parse(body);

    if (!email || !password) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "Missing fields" }));
        return;
    }

    const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName },
    });

    if (error) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: error.message }));
    } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ user_id: data.user.id }));
    }
}
