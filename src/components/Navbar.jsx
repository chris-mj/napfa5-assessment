import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";
import { supabase } from "../lib/supabaseClient";

export default function Navbar({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const link = "px-3 py-2 rounded hover:bg-gray-100";
  const active = "bg-gray-200";
  const isOwner = isPlatformOwner(user);
  const [canManageUsers, setCanManageUsers] = useState(false);
  const [roleLabel, setRoleLabel] = useState("");

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        if (!user?.id) { if (!ignore) setCanManageUsers(false); return; }
        const { data } = await supabase
          .from('memberships')
          .select('role')
          .eq('user_id', user.id);
        const roles = (data||[]).map(r => String(r.role||'').toLowerCase());
        if (!ignore) {
          setCanManageUsers(roles.includes('admin') || roles.includes('superadmin'));
          const label = roles.includes('superadmin') ? 'superadmin'
                       : roles.includes('admin') ? 'admin'
                       : roles.includes('score_taker') ? 'score_taker'
                       : roles.includes('viewer') ? 'viewer'
                       : '';
          setRoleLabel(label);
        }
      } catch { if (!ignore) setCanManageUsers(false); }
    };
    load();
    return () => { ignore = true };
  }, [user?.id]);

  return (
    <header className="bg-white shadow">
      <nav className="p-3 flex items-center justify-between">
        <NavLink to="/" className="flex items-center gap-2">
          <img src="/icon.png" alt="NAPFA5" className="w-6 h-6" />
          <span className="font-bold">NAPFA5</span>
        </NavLink>
        <div className="flex items-center gap-2">
          <button
            className="md:hidden inline-flex items-center justify-center p-2 rounded hover:bg-gray-100"
            aria-label={open ? "Close menu" : "Open menu"}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <svg className="w-6 h-6 text-gray-800" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
            <div className="hidden md:flex gap-3">
              <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                Home
              </NavLink>
              {user && (
                <>
                  <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Dashboard
                  </NavLink>
                  {canManageUsers && (
                    <NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                      Sessions
                    </NavLink>
                  )}
                  <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Score Entry
                  </NavLink>
                  {canManageUsers && (
                    <NavLink to="/manage-students" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                      Manage Students
                    </NavLink>
                  )}
                  {canManageUsers && (
                    <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                      Manage Users
                    </NavLink>
                  )}
                  {isOwner && (
                    <>
                      <NavLink to="/create-school" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                        Manage Schools
                      </NavLink>
                      <NavLink to="/admin-global" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                        Global Admin
                      </NavLink>
                    </>
                  )}
                </>
              )}
            <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
              Contact Us
            </NavLink>
            {user ? (
              <>
                <div className="text-sm text-gray-600 whitespace-nowrap text-right">
                  <div>
                    <NavLink to="/profile" className="hover:underline" title="Edit profile">
                      {user.email}
                    </NavLink>
                  </div>
                  {roleLabel && (<div className="text-xs text-gray-400">{roleLabel}</div>)}
                </div>
                <button onClick={onLogout} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Logout</button>
              </>
            ) : (
              <NavLink to="/login" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                Login
              </NavLink>
            )}
          </div>
        </div>
      </nav>
            {/* Animated mobile panel */}
            <div className="md:hidden px-3">
                <div className={open ? "border-t pb-3 space-y-2 transition-all duration-200" : "border-t pb-0 h-0 overflow-hidden transition-all duration-200"}>
                  <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Home</NavLink>
                  {user && (
                    <>
                      <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Dashboard</NavLink>
                      {canManageUsers && (<NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Sessions</NavLink>)}
                      {canManageUsers && (<NavLink to="/manage-students" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Students</NavLink>)}
                      <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Score Entry</NavLink>
                      {canManageUsers && (
                        <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Users</NavLink>
                      )}
                      {isOwner && (
                        <>
                      <NavLink to="/create-school" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Manage Schools</NavLink>
                          <NavLink to="/admin-global" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Global Admin</NavLink>
                        </>
                      )}
                    </>
                  )}
                  <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Contact Us</NavLink>
                  <div className="pt-2 flex items-center justify-between gap-2">
                    {user ? (
                      <>
                        <div className="text-sm text-gray-600 truncate">
                          <div><NavLink to="/profile" onClick={() => setOpen(false)} className="hover:underline" title="Edit profile">{user.email}</NavLink></div>
                          {roleLabel && (<div className="text-xs text-gray-400">{roleLabel}</div>)}
                        </div>
                        <button onClick={onLogout} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Logout</button>
                      </>
                    ) : (
                      <NavLink to="/login" className={({ isActive }) => `${link} ${isActive ? active : ""}`} onClick={() => setOpen(false)}>Login</NavLink>
                    )}
                  </div>
                </div>
            </div>
    </header>
  );
}
