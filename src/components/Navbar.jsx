import { useState } from "react";
import { NavLink } from "react-router-dom";
import { isPlatformOwner } from "../lib/roles";

export default function Navbar({ user, onLogout }) {
  const [open, setOpen] = useState(false);
  const link = "px-3 py-2 rounded hover:bg-gray-100";
  const active = "bg-gray-200";
  const isOwner = isPlatformOwner(user);

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
                  <NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Sessions
                  </NavLink>
                  <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Score Entry
                  </NavLink>
                  {isOwner && (
                    <>
                      <NavLink to="/create-school" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                        Create School
                      </NavLink>
                      <NavLink to="/admin-global" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                        Global Admin
                      </NavLink>
                    </>
                  )}
                  <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
                    Modify Users
                  </NavLink>
                </>
              )}
            <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""}`}>
              Contact Us
            </NavLink>
            {user ? (
              <>
                <div className="text-sm text-gray-600 whitespace-nowrap">{user.email}</div>
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
      {open && (
        <div className="md:hidden border-t px-3 pb-3 space-y-2">
          <NavLink to="/" end className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Home</NavLink>
          {user && (
            <>
              <NavLink to="/dashboard" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Dashboard</NavLink>
              <NavLink to="/sessions" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Sessions</NavLink>
              <NavLink to="/add-attempt" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Score Entry</NavLink>
              {isOwner && (
                <>
                  <NavLink to="/create-school" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Create School</NavLink>
                  <NavLink to="/admin-global" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Global Admin</NavLink>
                </>
              )}
              <NavLink to="/modify-user" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Modify Users</NavLink>
            </>
          )}
          <NavLink to="/contact" className={({ isActive }) => `${link} ${isActive ? active : ""} block`} onClick={() => setOpen(false)}>Contact Us</NavLink>
          <div className="pt-2 flex items-center justify-between gap-2">
            {user ? (
              <>
                <div className="text-sm text-gray-600 truncate">{user.email}</div>
                <button onClick={onLogout} className="text-sm px-3 py-1 bg-red-500 text-white rounded hover:bg-red-600">Logout</button>
              </>
            ) : (
              <NavLink to="/login" className={({ isActive }) => `${link} ${isActive ? active : ""}`} onClick={() => setOpen(false)}>Login</NavLink>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
