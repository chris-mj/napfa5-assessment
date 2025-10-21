import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export default function Login({ onLogin }) {
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [useMagic, setUseMagic] = useState(false);
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState("");

    // ✅ Detect magic-link sessions automatically
    useEffect(() => {
        const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session?.user) {
                // Redirect automatically after successful magic-link login
                window.location.href = "/dashboard";
            }
        });
        return () => listener.subscription.unsubscribe();
    }, []);
    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage("");
        setLoading(true);

        try {
            if (useMagic) {
                const { error } = await supabase.auth.signInWithOtp({ email });
                if (error) throw error;
                setMessage("✅ Magic link sent! Check your email.");
            } else {
                const { data, error } = await supabase.auth.signInWithPassword({
                    email,
                    password,
                });

                if (error?.message?.includes("Invalid login credentials please contact admin")) {
                    // if (window.confirm("No account found. Create one?")) {
                    //     const { error: signUpError } = await supabase.auth.signUp({
                    //         email,
                    //         password,
                    //     });
                    //     if (signUpError) throw signUpError;
                    //     setMessage("✅ Account created. Please verify your email.");
                    // }
                } else if (error) {
                    throw error;
                } else if (data?.user) {
                    setMessage("✅ Signed in successfully!");
                    onLogin?.(data?.user || null);
                    window.location.href = "/dashboard";
                }
            }
        } catch (err) {
            setMessage("❌ " + err.message);
        } finally {
            setLoading(false);
        }
    };


    return (
        <div className="flex justify-center items-center h-[80vh]">
            <form
                onSubmit={handleSubmit}
                className="p-6 w-[360px] bg-white border rounded shadow space-y-4"
            >
                <h1 className="text-xl font-bold text-center">NAPFA5 Login</h1>

                <input
                    type="email"
                    required
                    placeholder="Email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="border rounded w-full p-2"
                />

                {!useMagic && (
                    <input
                        type="password"
                        required
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="border rounded w-full p-2"
                    />
                )}

                <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 text-white rounded w-full py-2 hover:bg-blue-700"
                >
                    {loading
                        ? "Please wait..."
                        : useMagic
                            ? "Send Magic Link"
                            : "Sign In / Sign Up"}
                </button>

                <button
                    type="button"
                    onClick={() => setUseMagic(!useMagic)}
                    className="text-sm text-blue-700 underline w-full"
                >
                    {useMagic ? "Use password login" : "Use magic link instead"}
                </button>

                <button
                    type="button"
                    onClick={async () => {
                        if (!email) return setMessage("Please enter your email first.");
                        const { error } = await supabase.auth.resetPasswordForEmail(email, {
                            redirectTo: `${window.location.origin}/change-password`,
                        });
                        if (error) setMessage("❌ " + error.message);
                        else setMessage("📩 Password reset link sent to your email.");
                    }}
                    className="text-sm text-blue-700 underline w-full"
                >
                    Forgot password?
                </button>


                {message && (
                    <p className="text-sm text-center text-gray-700 whitespace-pre-wrap">
                        {message}
                    </p>
                )}
            </form>
        </div>
    );
}
