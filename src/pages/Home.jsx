import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";

export default function Home({ user }) {
    const navLinkClass =
        "inline-block px-4 py-2 border border-blue-600 text-blue-600 rounded hover:bg-blue-50";

    return (
        <div className="p-6 space-y-4">
            <h1 className="text-2xl font-bold">NAPFA5 Assessment</h1>
            <p className="text-gray-600">
                Track student performance, manage schools, and administer user access from a single
                dashboard. Use the navigation bar to explore, or jump in using the quick links below.
            </p>
            <div className="flex flex-wrap gap-3">
                <NavLink to="/students" className={navLinkClass}>
                    View Students
                </NavLink>
                <NavLink to="/add-attempt" className={navLinkClass}>
                    Record Attempt
                </NavLink>
                {isPlatformOwner(user) && (
                    <NavLink to="/admin-global" className={navLinkClass}>
                        Global Admin
                    </NavLink>
                )}
            </div>
        </div>
    );
}
