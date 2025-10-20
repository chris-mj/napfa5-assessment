export const SUPER_SUPERADMIN_EMAIL = "christopher_teo_ming_jian@moe.edu.sg";

export function isPlatformOwner(user) {
    return (
        !!user?.email &&
        user.email.toLowerCase() === SUPER_SUPERADMIN_EMAIL.toLowerCase()
    );
}

/**
 * Fetch the user's memberships and return an array of { school_id, role, school_name }
 * Each membership row joins the schools table for convenience.
 */
export async function getUserRoles(user, supabase) {
    if (!user) return [];
    const { data, error } = await supabase
        .from("memberships")
        .select("role, school_id, schools!inner(name)")
        .eq("user_id", user.id);
    if (error) {
        console.error("getUserRoles error", error.message);
        return [];
    }
    return (data || []).map((r) => ({
        role: r.role,
        school_id: r.school_id,
        school_name: r.schools.name,
    }));
}
