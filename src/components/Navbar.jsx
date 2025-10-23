import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";

export default function Navbar({ user, onLogout }) {
    const link = "px-3 py-2 rounded hover:bg-gray-100";
    const active = "bg-gray-200";
    const isOwner = isPlatformOwner(user);

    return (
        <nav className="bg-white shadow p-3 flex justify-between items-center">
            <NavLink to="/" className="flex items-center gap-2">
                <img src="/icon.png" alt="NAPFA5" className="w-6 h-6" />
                <span className="font-bold">NAPFA5</span>
            </NavLink>

            <div className="flex gap-3">
                <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Home
                </NavLink>

                {user && (
                    <>
                        <NavLink
                            to="/dashboard"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Dashboard
                        </NavLink>
                        <NavLink
                            to="/sessions"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Sessions
                        </NavLink>
                        {isOwner && (
                            <>
                                <NavLink
                                    to="/create-school"
                                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                                >
                                    Create School
                                </NavLink>
                                <NavLink
                                    to="/admin-global"
                                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                                >
                                    Global Admin
                                </NavLink>
                            </>
                        )}
                        <NavLink
                            to="/modify-user"
                            className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                        >
                            Modify Users
                        </NavLink>
                    </>
                )}
            </div>

            <div className="flex items-center gap-3">
                <NavLink
                    to="/contact"
                    className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                >
                    Contact Us
                </NavLink>
                {user ? (
                    <>
                        <div className="text-sm text-gray-600">{user.email}</div>
                        <button
                            onClick={onLogout}
                            className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600"
                        >
                            Logout
                        </button>
                    </>
                ) : (
                    <NavLink
                        to="/login"
                        className={({ isActive }) => `${link} ${isActive ? active : ""}`}
                    >
                        Login
                    </NavLink>
                )}
            </div>
        </nav>
    );
}
