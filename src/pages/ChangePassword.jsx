import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useNavigate } from "react-router-dom";

export default function ChangePassword() {
    const [password, setPassword] = useState("");
    const [confirm, setConfirm] = useState("");
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setMessage("");
        if (password !== confirm) {
            setMessage("❌ Passwords do not match.");
            return;
        }
        if (password.length < 8) {
            setMessage("❌ Password must be at least 8 characters.");
            return;
        }

        setLoading(true);
        const { error } = await supabase.auth.updateUser({ password });
        setLoading(false);

        if (error) setMessage("❌ " + error.message);
        else {
            setMessage("✅ Password updated successfully.");
            setTimeout(() => navigate("/"), 1000);
        }
    };

    return (
        <div className="flex justify-center items-center h-[80vh]">
            <form
                onSubmit={handleSubmit}
                className="p-6 w-[360px] bg-white border rounded shadow space-y-4"
            >
                <h1 className="text-xl font-bold text-center">Change Password</h1>
                <input
                    type="password"
                    placeholder="New password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="border rounded p-2 w-full"
                />
                <input
                    type="password"
                    placeholder="Confirm new password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    className="border rounded p-2 w-full"
                />
                <button
                    type="submit"
                    disabled={loading}
                    className="bg-blue-600 text-white w-full py-2 rounded hover:bg-blue-700"
                >
                    {loading ? "Updating…" : "Change Password"}
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
