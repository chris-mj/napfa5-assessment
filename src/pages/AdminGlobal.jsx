import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";
import { Link, useNavigate } from "react-router-dom";

export default function AdminGlobal({ user }) {
    const navigate = useNavigate();
    const [schools, setSchools] = useState([]);
    const [loading, setLoading] = useState(true);
    const allowed = isPlatformOwner(user);

    useEffect(() => {
        if (!allowed) return;
        (async () => {
            const { data, error } = await supabase.from("schools").select("id, name, type, created_at").order("name");
            if (error) console.error(error);
            setSchools(data || []);
            setLoading(false);
        })();
    }, [allowed]);

    if (!user) return <div className="p-6">Please login.</div>;
    if (!allowed) return <div className="p-6 text-red-600">Access denied.</div>;

    return (
        <div className="p-6 max-w-4xl">
            <div className="flex items-center justify-between mb-4">
                <h1 className="text-2xl font-bold">Global Admin</h1>
                <div className="flex gap-2">
                    <Link to="/admin/create-school" className="bg-blue-600 text-white px-3 py-2 rounded hover:bg-blue-700">
                        + Create School
                    </Link>
                    <Link to="/admin/modify-user" className="bg-green-600 text-white px-3 py-2 rounded hover:bg-green-700">
                        + Modify Users
                    </Link>
                </div>
            </div>

            {loading ? (
                <div>Loading…</div>
            ) : (
                <table className="min-w-full border rounded">
                    <thead>
                    <tr className="bg-gray-100 text-left">
                        <th className="border px-3 py-2">Name</th>
                        <th className="border px-3 py-2">Type</th>
                        <th className="border px-3 py-2">Created</th>
                    </tr>
                    </thead>
                    <tbody>
                    {schools.map(s => (
                        <tr key={s.id}>
                            <td className="border px-3 py-2">{s.name}</td>
                            <td className="border px-3 py-2">{s.type}</td>
                            <td className="border px-3 py-2">{new Date(s.created_at).toLocaleString("en-SG")}</td>
                        </tr>
                    ))}
                    {schools.length === 0 && (
                        <tr><td colSpan={3} className="border px-3 py-4 text-center text-gray-500">No schools yet.</td></tr>
                    )}
                    </tbody>
                </table>
            )}
        </div>
    );
}
