import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";
import { useNavigate } from "react-router-dom";

export default function CreateSchool({ user }) {
    const navigate = useNavigate();
    const allowed = isPlatformOwner(user);

    const [schools, setSchools] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState("");

    const [query, setQuery] = useState("");
    const [adding, setAdding] = useState(false);
    const [newSchool, setNewSchool] = useState({ name: "", type: "secondaryJC", code: "" });

    const [editingId, setEditingId] = useState(null);
    const [editForm, setEditForm] = useState({ name: "", type: "secondaryJC", code: "" });
    const [saving, setSaving] = useState(false);
    const normalizeCode = (value) => {
        const trimmed = String(value || "").trim();
        return trimmed ? trimmed.toUpperCase() : "";
    };

    useEffect(() => {
        if (!allowed || !user) return;
        let ignore = false;
        const load = async () => {
            setLoading(true);
            setMessage("");
            const { data, error } = await supabase
                .from("schools")
                .select("id, name, type, code")
                .order("name");
            if (!ignore) {
                if (error) {
                    setMessage(error.message || "Failed to load schools.");
                    setSchools([]);
                } else {
                    setSchools(data || []);
                }
                setLoading(false);
            }
        };
        load();
        return () => { ignore = true };
    }, [allowed, user?.id]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        return !q ? schools : schools.filter(s => (s.name||"").toLowerCase().includes(q));
    }, [schools, query]);

    const startAdd = () => { setAdding(true); setNewSchool({ name: "", type: "secondaryJC", code: "" }); setMessage(""); };
    const cancelAdd = () => { setAdding(false); setNewSchool({ name: "", type: "secondaryJC", code: "" }); };

    const submitAdd = async (e) => {
        e.preventDefault();
        if (!allowed) { setMessage("Access denied."); return; }
        if (!newSchool.name.trim()) { setMessage("School name is required."); return; }
        setSaving(true);
        const code = normalizeCode(newSchool.code);
        const { data, error } = await supabase
            .from("schools")
            .insert([{ name: newSchool.name.trim(), type: newSchool.type, code: code || null }])
            .select("id, name, type, code")
            .single();
        setSaving(false);
        if (error) { setMessage(error.message || "Failed to create school."); return; }
        setSchools(prev => [...prev, data].sort((a,b)=>a.name.localeCompare(b.name)));
        setAdding(false);
        setNewSchool({ name: "", type: "secondaryJC", code: "" });
        setMessage("School created.");
    };

    const startEdit = (s) => { setEditingId(s.id); setEditForm({ name: s.name, type: s.type, code: s.code || "" }); setMessage(""); };
    const cancelEdit = () => { setEditingId(null); setEditForm({ name: "", type: "secondaryJC", code: "" }); };
    const submitEdit = async (e) => {
        e?.preventDefault?.();
        if (!editingId) return;
        if (!editForm.name.trim()) { setMessage("School name is required."); return; }
        setSaving(true);
        const code = normalizeCode(editForm.code);
        const { error } = await supabase
            .from("schools")
            .update({ name: editForm.name.trim(), type: editForm.type, code: code || null })
            .eq("id", editingId);
        setSaving(false);
        if (error) { setMessage(error.message || "Failed to update school."); return; }
        setSchools(prev => prev.map(s => s.id === editingId ? { ...s, name: editForm.name.trim(), type: editForm.type, code: code || null } : s).sort((a,b)=>a.name.localeCompare(b.name)));
        setEditingId(null);
        setMessage("School updated.");
    };

    const removeSchool = async (s) => {
        if (!window.confirm(`Delete school "${s.name}"? This cannot be undone.`)) return;
        setSaving(true);
        const { error } = await supabase
            .from("schools")
            .delete()
            .eq("id", s.id);
        setSaving(false);
        if (error) { setMessage(error.message || "Failed to delete school."); return; }
        setSchools(prev => prev.filter(x => x.id !== s.id));
        setMessage("School deleted.");
    };

    if (!user) return <div className="p-6">Please login.</div>;
    if (!allowed) return <div className="p-6 text-red-600">Access denied.</div>;

    return (
        <div className="p-6 max-w-6xl mx-auto">
            <h1 className="text-2xl font-bold mb-4">Manage Schools</h1>
            <div className="flex items-center gap-2 mb-4">
                <input value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="Search schools" className="border rounded p-2 w-full max-w-sm" />
                {!adding ? (
                    <button className="px-3 py-2 bg-blue-600 text-white rounded" onClick={startAdd}>Add School</button>
                ) : (
                    <button className="px-3 py-2 border rounded" onClick={cancelAdd}>Cancel</button>
                )}
                <button className="px-3 py-2 border rounded" onClick={()=>navigate('/admin-global')}>Back</button>
            </div>

            {message && <p className="text-sm mb-3">{message}</p>}

            {adding && (
                <form onSubmit={submitAdd} className="border rounded p-4 bg-white shadow-sm mb-4 grid gap-3 md:grid-cols-3">
                    <label className="text-sm">
                        <div className="mb-1">School Name</div>
                        <input value={newSchool.name} onChange={(e)=>setNewSchool(p=>({...p, name: e.target.value}))} className="border rounded p-2 w-full" required />
                    </label>
                    <label className="text-sm">
                        <div className="mb-1">Abbreviation</div>
                        <input value={newSchool.code} onChange={(e)=>setNewSchool(p=>({...p, code: e.target.value}))} className="border rounded p-2 w-full" placeholder="e.g. ABC" />
                    </label>
                    <label className="text-sm">
                        <div className="mb-1">Type</div>
                        <select value={newSchool.type} onChange={(e)=>setNewSchool(p=>({...p, type: e.target.value}))} className="border rounded p-2 w-full">
                            <option value="primary">Primary</option>
                            <option value="secondaryJC">Secondary/JC</option>
                        </select>
                    </label>
                    <div className="flex items-end gap-2">
                        <button type="submit" className="px-3 py-2 bg-green-600 text-white rounded disabled:opacity-50" disabled={saving}>{saving ? 'Saving...' : 'Create'}</button>
                    </div>
                </form>
            )}

            <div className="grid gap-4 md:grid-cols-2">
                <div className="border rounded bg-white shadow-sm">
                    <div className="px-3 py-2 border-b font-medium">Primary</div>
                    {loading ? (
                        <div className="p-4">Loading...</div>
                    ) : (
                        (() => {
                            const list = [...filtered.filter(s => s.type === 'primary')].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
                            if (!list.length) return <div className="p-4 text-sm text-gray-600">No primary schools.</div>;
                            return (
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-100 text-left">
                                            <th className="px-3 py-2 border">Name</th>
                                            <th className="px-3 py-2 border w-32">Abbrev</th>
                                            <th className="px-3 py-2 border w-40">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {list.map((s) => (
                                            <tr key={s.id}>
                                                <td className="px-3 py-2 border">
                                                    {editingId === s.id ? (
                                                        <>
                                                            <input value={editForm.name} onChange={(e)=>setEditForm(p=>({...p, name: e.target.value}))} className="border rounded p-1 w-full" />
                                                            <input type="hidden" value={editForm.type} />
                                                        </>
                                                    ) : (
                                                        s.name
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 border">
                                                    {editingId === s.id ? (
                                                        <input value={editForm.code} onChange={(e)=>setEditForm(p=>({...p, code: e.target.value}))} className="border rounded p-1 w-full" />
                                                    ) : (
                                                        s.code || "-"
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 border space-x-2">
                                                    {editingId === s.id ? (
                                                        <>
                                                            <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={submitEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                                                            <button className="px-2 py-1 border rounded" onClick={cancelEdit}>Cancel</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className="px-2 py-1 border rounded" onClick={()=>{ setEditForm({ name: s.name, type: 'primary', code: s.code || '' }); startEdit(s); }}>Edit</button>
                                                            <button className="px-2 py-1 border rounded text-red-600" onClick={()=>removeSchool(s)} disabled={saving}>Delete</button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()
                    )}
                </div>
                <div className="border rounded bg-white shadow-sm">
                    <div className="px-3 py-2 border-b font-medium">Secondary/JC</div>
                    {loading ? (
                        <div className="p-4">Loading...</div>
                    ) : (
                        (() => {
                            const list = [...filtered.filter(s => s.type === 'secondaryJC')].sort((a,b)=> (a.name||'').localeCompare(b.name||''));
                            if (!list.length) return <div className="p-4 text-sm text-gray-600">No secondary/JC schools.</div>;
                            return (
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="bg-gray-100 text-left">
                                            <th className="px-3 py-2 border">Name</th>
                                            <th className="px-3 py-2 border w-32">Abbrev</th>
                                            <th className="px-3 py-2 border w-40">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {list.map((s) => (
                                            <tr key={s.id}>
                                                <td className="px-3 py-2 border">
                                                    {editingId === s.id ? (
                                                        <>
                                                            <input value={editForm.name} onChange={(e)=>setEditForm(p=>({...p, name: e.target.value}))} className="border rounded p-1 w-full" />
                                                            <input type="hidden" value={editForm.type} />
                                                        </>
                                                    ) : (
                                                        s.name
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 border">
                                                    {editingId === s.id ? (
                                                        <input value={editForm.code} onChange={(e)=>setEditForm(p=>({...p, code: e.target.value}))} className="border rounded p-1 w-full" />
                                                    ) : (
                                                        s.code || "-"
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 border space-x-2">
                                                    {editingId === s.id ? (
                                                        <>
                                                            <button className="px-2 py-1 bg-green-600 text-white rounded" onClick={submitEdit} disabled={saving}>{saving ? 'Saving...' : 'Save'}</button>
                                                            <button className="px-2 py-1 border rounded" onClick={cancelEdit}>Cancel</button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button className="px-2 py-1 border rounded" onClick={()=>{ setEditForm({ name: s.name, type: 'secondaryJC', code: s.code || '' }); startEdit(s); }}>Edit</button>
                                                            <button className="px-2 py-1 border rounded text-red-600" onClick={()=>removeSchool(s)} disabled={saving}>Delete</button>
                                                        </>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            );
                        })()
                    )}
                </div>
            </div>
        </div>
    );
}
