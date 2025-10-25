import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { isPlatformOwner } from "../lib/roles";

async function createOrLinkUserRPC({ email, fullName, schoolId, role, supabase }) {
    const { data, error } = await supabase.rpc("create_or_link_user", {
        p_email: email,
        p_full_name: fullName,
        p_school: schoolId,
        p_role: role,
    });
    return { data, error };
}


const ROLES = ["superadmin", "admin", "score_taker", "viewer"];

const INITIAL_FORM = {
    fullName: "",
    email: "",
    password: "",
    role: "admin",
};

export default function ModifyUser({ user }) {
    const [schools, setSchools] = useState([]);
    const [schoolId, setSchoolId] = useState("");
    const [members, setMembers] = useState([]);
    const [membersLoading, setMembersLoading] = useState(false);
    const [form, setForm] = useState(INITIAL_FORM);
    const [submitting, setSubmitting] = useState(false);
    const [pendingMemberId, setPendingMemberId] = useState(null);
    const [feedback, setFeedback] = useState(null);

    const platformOwner = isPlatformOwner(user);

    useEffect(() => {
        if (!user) return;
        (async () => {
            if (platformOwner) {
                const { data, error } = await supabase
                    .from("schools")
                    .select("id, name")
                    .order("name");
                if (error) {
                    console.error("Failed to load schools:", error.message);
                    setFeedback({ type: "error", text: "Unable to load schools." });
                    return;
                }
                setSchools(data || []);
            } else {
                const { data, error } = await supabase
                    .from("memberships")
                    .select("schools!inner(id, name)")
                    .eq("user_id", user.id)
                    .eq("role", "superadmin");
                if (error) {
                    console.error("Failed to load schools:", error.message);
                    setFeedback({ type: "error", text: "Unable to load schools." });
                    return;
                }
                setSchools((data || []).map((record) => record.schools));
            }
        })();
    }, [platformOwner, user]);

    useEffect(() => {
        if (!schools.length) {
            setSchoolId("");
            setMembers([]);
            return;
        }
        if (!schoolId || !schools.some((school) => school.id === schoolId)) {
            setSchoolId(schools[0].id);
        }
    }, [schools, schoolId]);

    const loadMembers = useCallback(
        async (targetSchoolId) => {
            const resolvedSchoolId = targetSchoolId || schoolId;
            if (!resolvedSchoolId) return;
            setMembersLoading(true);
            const { data, error } = await supabase
                .from("memberships")
                .select("id, role, user_id, profiles:profiles!inner(full_name, email)")
                .eq("school_id", resolvedSchoolId);
            if (error) {
                console.error("Failed to fetch members:", error.message);
                setFeedback({ type: "error", text: "Unable to load users for the selected school." });
                setMembers([]);
            } else {
                const rows = (data || []).map((row) => ({
                    id: row.id,
                    role: row.role,
                    userId: row.user_id,
                    fullName: row.profiles?.full_name || "",
                    email: row.profiles?.email || "",
                }));
                rows.sort((a, b) => (a.fullName || "").localeCompare(b.fullName || ""));
                setMembers(rows);
            }
            setMembersLoading(false);
        },
        [schoolId]
    );

    useEffect(() => {
        if (!schoolId) {
            setMembers([]);
            return;
        }
        loadMembers(schoolId);
    }, [schoolId, loadMembers]);

    useEffect(() => {
        if (!schoolId) return;
        const channel = supabase
            .channel(`memberships:${schoolId}`)
            .on(
                "postgres_changes",
                { event: "*", schema: "public", table: "memberships", filter: `school_id=eq.${schoolId}` },
                () => {
                    loadMembers(schoolId);
                }
            )
            .subscribe();
        return () => {
            supabase.removeChannel(channel);
        };
    }, [schoolId, loadMembers]);

    const memberEmails = useMemo(
        () => new Set(members.map((member) => member.email.toLowerCase())),
        [members]
    );

    const handleInputChange = (field) => (event) => {
        setForm((prev) => ({ ...prev, [field]: event.target.value }));
    };

    const handleAddUser = async (event) => {
        event.preventDefault();
        setFeedback(null);

        if (!schoolId) {
            setFeedback({ type: "error", text: "Select a school first." });
            return;
        }

        if (!form.fullName || !form.email || !form.password) {
            setFeedback({ type: "error", text: "Fill in full name, email, and password." });
            return;
        }

        if (memberEmails.has(form.email.toLowerCase())) {
            setFeedback({ type: "error", text: "A user with this email is already linked to the school." });
            return;
        }

        // setSubmitting(true);
        // try {
            // let targetUserId = null;
            // // See if the profile already exists; if so, reuse that user id.
            // const { data: existingProfile, error: lookupError } = await supabase
            //     .from("profiles")
            //     .select("user_id, full_name")
            //     .eq("email", form.email)
            //     .maybeSingle();
            //
            // if (lookupError) {
            //     setFeedback({
            //         type: "error",
            //         text: lookupError.message || "Failed to look up existing profile.",
            //     });
            //     return;
            // }
            //
            // if (existingProfile?.user_id) {
            //     targetUserId = existingProfile.user_id;
            // } else {
            //     // No profile, so create an auth user + profile.
            //     const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
            //         email: form.email,
            //         password: form.password,
            //         options: { data: { full_name: form.fullName } },
            //     });
            //
            //     if (signUpError) {
            //         if (signUpError.message?.toLowerCase().includes("already registered")) {
            //             // Auth user exists but profile might not; try fetching the profile again to continue.
            //             const { data: retryProfile, error: retryError } = await supabase
            //                 .from("profiles")
            //                 .select("user_id")
            //                 .eq("email", form.email)
            //                 .maybeSingle();
            //             if (retryError || !retryProfile?.user_id) {
            //                 setFeedback({
            //                     type: "error",
            //                     text: "This email already has an account. Ask them to reset their password.",
            //                 });
            //                 return;
            //             }
            //             targetUserId = retryProfile.user_id;
            //         } else {
            //             setFeedback({
            //                 type: "error",
            //                 text: signUpError.message || "Failed to sign up the user.",
            //             });
            //             return;
            //         }
            //     } else {
            //         const newUser = signUpData?.user;
            //         if (!newUser) {
            //             setFeedback({ type: "error", text: "User account was not created." });
            //             return;
            //         }
            //         targetUserId = newUser.id;
            //     }
            // }
            //
            // const { error: profileError } = await supabase.from("profiles").upsert({
            //     user_id: targetUserId,
            //     full_name: form.fullName,
            //     email: form.email,
            // });
            // if (profileError) {
            //     setFeedback({
            //         type: "error",
            //         text: profileError.message || "Failed to save profile.",
            //     });
            //     return;
            // }
            //
            // const { data: existingMemberships, error: membershipLookupError } = await supabase
            //     .from("memberships")
            //     .select("id, school_id")
            //     .eq("user_id", targetUserId);
            //
            // if (membershipLookupError) {
            //     setFeedback({
            //         type: "error",
            //         text: membershipLookupError.message || "Unable to check existing membership.",
            //     });
            //     return;
            // }
            //
            // if (existingMemberships && existingMemberships.length > 0) {
            //     const alreadyInSchool = existingMemberships.some(
            //         (membership) => membership.school_id === schoolId
            //     );
            //     setFeedback({
            //         type: "error",
            //         text: alreadyInSchool
            //             ? "This user is already linked to this school."
            //             : "This user has been registered to another school.",
            //     });
            //     return;
            // }
            //
            // const { error: membershipError } = await supabase.from("memberships").insert({
            //     user_id: targetUserId,
            //     school_id: schoolId,
            //     role: form.role,
            // });
        //     if (membershipError) {
        //         setFeedback({
        //             type: "error",
        //             text: membershipError.message || "Failed to link user to school.",
        //         });
        //         return;
        //     }
        //     setFeedback({ type: "success", text: "User added and linked to the school." });
        //
        //     setForm(INITIAL_FORM);
        //     await loadMembers();
        // } finally {
        //     setSubmitting(false);
        // }
        setSubmitting(true)
        try {
            // 1?? try the RPC first
            const { data, error } = await supabase.rpc('create_or_link_user', {
                p_email: form.email,
                p_full_name: form.fullName,
                p_school: schoolId,
                p_role: form.role,
            })

            // 2??  AUTH_USER_MISSING ? create the Auth user, then call RPC again
            if (error?.message === "AUTH_USER_MISSING" || error?.code === "P0002") {
                // Call /api/createUser and link user (as you already have)
                setFeedback({ type: "info", text: "Creating new user..." });
                // determine which API base to use
                const apiBase = import.meta.env.DEV
                    ? "https://napfa5-assessment.vercel.app" // ?? replace with your actual deployed domain
                    : "";

                const response = await fetch(`${apiBase}/api/createUser`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        email: form.email,
                        password: form.password || "test1234",
                        fullName: form.fullName,
                    }),
                });

                // const response = await fetch("/api/createUser", {
                //     method: "POST",
                //     headers: { "Content-Type": "application/json" },
                //     body: JSON.stringify({
                //         email: form.email,
                //         password: form.password || "test1234",
                //         fullName: form.fullName,
                //     }),
                // });
                const result = await response.json();

                if (!response.ok) {
                    setFeedback({ type: "error", text: "User creation failed: " + result.error });
                    return;
                }

                // Then link via RPC
                const { data: linkData, error: linkError } = await supabase.rpc("create_or_link_user", {
                    p_email: form.email,
                    p_full_name: form.fullName,
                    p_school: schoolId,
                    p_role: form.role,
                });
                if (linkError) {
                    setFeedback({ type: "error", text: "Linking failed: " + linkError.message });
                    return;
                }

                setFeedback({ type: "success", text: "? User created and linked successfully." });
                setForm(INITIAL_FORM);
                await loadMembers(schoolId);
                return;
            }


            if (error) {
                setFeedback({ type: 'error', text: error.message })
                return
            }

            setFeedback({ type: 'success', text: 'User linked or updated successfully.' });
            setForm(INITIAL_FORM);
            await loadMembers(schoolId);

        } finally {
            setSubmitting(false)
        }

    };

    const handleRoleUpdate = async (member, newRole) => {
        if (member.role === newRole) return;
        setFeedback(null);
        setPendingMemberId(member.id);
        try {
            const { error } = await supabase
                .from("memberships")
                .update({ role: newRole })
                .eq("id", member.id);
            if (error) {
                setFeedback({ type: "error", text: error.message || "Unable to update role." });
                return;
            }
            setFeedback({ type: "success", text: "Role updated." });
            await loadMembers();
        } finally {
            setPendingMemberId(null);
        }
    };

    const handleRemoveMember = async (member) => {
        if (member.userId === user?.id) {
            setFeedback({ type: "error", text: "You cannot remove your own membership." });
            return;
        }
        const confirmed = window.confirm(
            `Remove ${member.fullName || member.email} from this school?`
        );
        if (!confirmed) return;

        setFeedback(null);
        setPendingMemberId(member.id);
        try {
            const { error } = await supabase
                .from("memberships")
                .delete()
                .eq("id", member.id);
            if (error) {
                setFeedback({ type: "error", text: error.message || "Unable to remove user." });
                return;
            }
            setFeedback({ type: "success", text: "User removed from the school." });
            await loadMembers();
        } finally {
            setPendingMemberId(null);
        }
    };

    const canAccess = platformOwner || schools.length > 0;

    if (!user) return <div className="p-6">Please login.</div>;
    if (!canAccess) return <div className="p-6 text-red-600">Access denied.</div>;

    return (
        <div className="p-6 max-w-3xl space-y-6">
    <div className="mb-4 text-sm text-gray-700 border rounded p-3 bg-gray-50">
        <div className="font-medium mb-1">Role legend</div>
        <div className="flex flex-wrap gap-3">
            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">admin/superadmin</span>
            <span>manage students, enrollments, sessions and roster; record scores when Active; completed sessions are read-only</span>
        </div>
        <div className="flex flex-wrap gap-3 mt-2">
            <span className="px-2 py-0.5 rounded bg-amber-100 text-amber-800">score_taker</span>
            <span>view students and scores; record scores only when session is Active; cannot manage roster</span>
        </div>
    </div>
            <div>
                <h1 className="text-2xl font-bold mb-4">Modify Users</h1>
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm mb-1">School</label>
                        <select
                            value={schoolId}
                            onChange={(event) => setSchoolId(event.target.value)}
                            className="border rounded p-2 w-full"
                        >
                            <option value="">Select a school</option>
                            {schools.map((school) => (
                                <option key={school.id} value={school.id}>
                                    {school.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            <form
                onSubmit={handleAddUser}
                className="border rounded p-4 space-y-3 bg-white shadow-sm"
            >
                <h2 className="text-lg font-semibold">Add User To School</h2>
                <div>
                    <label className="block text-sm mb-1">Role</label>
                    <select
                        value={form.role}
                        onChange={handleInputChange("role")}
                        className="border rounded p-2 w-full"
                    >
                        {ROLES.map((role) => (
                            <option key={role} value={role}>
                                {role}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className="block text-sm mb-1">Full Name</label>
                    <input
                        value={form.fullName}
                        onChange={handleInputChange("fullName")}
                        className="border rounded p-2 w-full"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm mb-1">Email</label>
                    <input
                        type="email"
                        value={form.email}
                        onChange={handleInputChange("email")}
                        className="border rounded p-2 w-full"
                        required
                    />
                </div>
                <div>
                    <label className="block text-sm mb-1">Password</label>
                    <input
                        type="password"
                        value={form.password}
                        onChange={handleInputChange("password")}
                        className="border rounded p-2 w-full"
                        required
                    />
                </div>
                <button
                    type="submit"
                    className="bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50"
                    disabled={submitting || !schoolId}
                >
                    {submitting ? "Processing..." : "Add / Link User"}
                </button>

            </form>

            <div className="border rounded p-4 bg-white shadow-sm">
                <h2 className="text-lg font-semibold mb-3">Existing Users</h2>
                {membersLoading ? (
                    <p>Loading users...</p>
                ) : members.length === 0 ? (
                    <p className="text-sm text-gray-600">No users linked to this school yet.</p>
                ) : (
                    <table className="min-w-full border text-sm">
                        <thead>
                            <tr className="bg-gray-100 text-left">
                                <th className="border px-3 py-2">Name</th>
                                <th className="border px-3 py-2">Email</th>
                                <th className="border px-3 py-2">Role</th>
                                <th className="border px-3 py-2 w-32">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {members.map((member) => (
                                <tr key={member.id}>
                                    <td className="border px-3 py-2">{member.fullName || "--"}</td>
                                    <td className="border px-3 py-2">{member.email}</td>
                                    <td className="border px-3 py-2">
                                        <select
                                            value={member.role}
                                            onChange={(event) =>
                                                handleRoleUpdate(member, event.target.value)
                                            }
                                            className="border rounded p-1 w-full"
                                            disabled={pendingMemberId === member.id}
                                        >
                                            {ROLES.map((roleOption) => (
                                                <option key={roleOption} value={roleOption}>
                                                    {roleOption}
                                                </option>
                                            ))}
                                        </select>
                                    </td>
                                    <td className="border px-3 py-2">
                                        <button
                                            type="button"
                                            onClick={() => handleRemoveMember(member)}
                                            className="text-red-600 hover:underline disabled:text-red-300"
                                            disabled={pendingMemberId === member.id}
                                        >
                                            Remove
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {feedback && (
                <p
                    className={`text-sm ${
                        feedback.type === "error" ? "text-red-600" : "text-green-600"
                    }`}
                >
                    {feedback.text}
                </p>
            )}
        </div>
    );
}