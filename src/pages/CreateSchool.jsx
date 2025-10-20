import { useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";
import { useNavigate } from "react-router-dom";

export default function CreateSchool({ user }) {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [type, setType] = useState("secondaryJC");
    const [msg, setMsg] = useState("");
    const allowed = isPlatformOwner(user);

    const submit = async (e) => {
        e.preventDefault();
        if (!allowed) return setMsg("Access denied.");

        const { data, error } = await supabase
            .from("schools")
            .insert([{ name, type }])
            .select()
            .single();

        if (error) return setMsg("❌ " + error.message);
        setMsg("✅ School created.");
        setTimeout(() => navigate("/admin/global"), 800);
    };

    if (!user) return <div className="p-6">Please login.</div>;
    if (!allowed) return <div className="p-6 text-red-600">Access denied.</div>;

    return (
        <div className="p-6 max-w-lg">
            <h1 className="text-2xl font-bold mb-4">Create School</h1>
            <form onSubmit={submit} className="space-y-3">
                <div>
                    <label className="block text-sm mb-1">School Name</label>
                    <input value={name} onChange={e=>setName(e.target.value)} className="border rounded p-2 w-full" required />
                </div>
                <div>
                    <label className="block text-sm mb-1">Type</label>
                    <select value={type} onChange={e=>setType(e.target.value)} className="border rounded p-2 w-full">
                        <option value="primary">Primary</option>
                        <option value="secondaryJC">Secondary/JC</option>
                    </select>
                </div>
                <button className="bg-blue-600 text-white px-4 py-2 rounded">Create</button>
            </form>
            {msg && <p className="mt-3 text-sm">{msg}</p>}
        </div>
    );
}
