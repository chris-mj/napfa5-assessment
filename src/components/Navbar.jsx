
import React from 'react'

export default function Navbar({ user, onLogout }){
  return (
    <nav className="bg-white shadow p-3 flex justify-between items-center">
      <div className="font-bold">NAPFA Tracker V2</div>
      <div className="flex items-center gap-3">
        {user ? <div className="text-sm">{user.email}</div> : null}
        {user ? <button className="text-sm px-3 py-1 bg-slate-100 rounded" onClick={onLogout}>Logout</button> : null}
      </div>
    </nav>
  )
}
