import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";

export default function Dashboard({ user }) {
    const navLinkClass =
        "inline-block px-4 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50";
    const showOwnerLinks = isPlatformOwner(user);

    return (
        <div className="p-6 space-y-4">
            <div>
                <h1 className="text-3xl font-semibold">Dashboard</h1>
                <p className="text-gray-700">Welcome back, <strong>{user?.email}</strong>.</p>
                <p className="text-gray-600">
                    Use these quick links to jump straight into the areas you manage most often.
                </p>
            </div>
            <div className="flex flex-wrap gap-3">
                <NavLink to="/students" className={navLinkClass}>
                    View Students
                </NavLink>
                <NavLink to="/add-attempt" className={navLinkClass}>
                    Record Attempt
                </NavLink>
                {showOwnerLinks && (
                    <NavLink to="/admin-global" className={navLinkClass}>
                        Global Admin
                    </NavLink>
                )}
            </div>
        </div>
    );
}
