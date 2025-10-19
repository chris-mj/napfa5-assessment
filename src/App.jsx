
import React, {useEffect, useState} from 'react'
import { supabase } from './lib/supabaseClient'
import Navbar from './components/Navbar'
import ScoreForm from './components/ScoreForm'
import Charts from './components/Charts'
import { computeTotalScore } from './utils/scoring'

export default function App(){
  const [user, setUser] = useState(null)
  const [students, setStudents] = useState([])
  const [selected, setSelected] = useState(null)
  const [scores, setScores] = useState([])

  useEffect(()=>{
    supabase.auth.getSession().then(r=>{
      if(r.data?.session) setUser(r.data.session.user)
    })
    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null)
    })
    return () => authListener.subscription.unsubscribe()
  }, [])

  useEffect(()=>{ if(user) loadStudents() }, [user])

  async function loadStudents(){
    const { data, error } = await supabase.from('students').select('*').order('name')
    if(error) return alert(error.message)
    setStudents(data)
    if(data?.length) setSelected(data[0])
  }

  async function loadScoresFor(studentId){
    const { data, error } = await supabase.from('scores').select('*').eq('student_id', studentId).order('test_date')
    if(error) return alert(error.message)
    setScores(data)
  }

  async function handleLogin(){
    const email = prompt('Enter teacher email to receive magic link (Supabase)')
    if(!email) return
    const { error } = await supabase.auth.signInWithOtp({ email })
    if(error) return alert(error.message)
    alert('Magic link sent — check your email')
  }

  async function handleLogout(){
    await supabase.auth.signOut()
    setUser(null)
  }

  function onStudentSelect(s){
    setSelected(s)
    loadScoresFor(s.id)
  }

  function onNewScore(score){
    loadScoresFor(selected.id)
  }

  return (
    <div className="min-h-screen">
      <Navbar user={user} onLogout={handleLogout} />
      <div className="container mx-auto p-4 grid grid-cols-4 gap-4">
        <div className="col-span-1">
          <div className="bg-white p-4 rounded shadow">
            {!user ? (
              <div>
                <h3 className="font-semibold mb-2">Sign in</h3>
                <p className="text-sm mb-3">Sign in with Magic Link</p>
                <button onClick={handleLogin} className="px-4 py-2 bg-blue-600 text-white rounded">Send magic link</button>
              </div>
            ) : (
              <div>
                <h3 className="font-semibold mb-2">Students</h3>
                <div className="space-y-2">
                  {students.length? students.map(s=> (
                    <div key={s.id} className={`p-2 border rounded cursor-pointer ${selected?.id===s.id? 'bg-slate-100':'bg-white'}`} onClick={()=>onStudentSelect(s)}>
                      <div className="font-medium">{s.name}</div>
                      <div className="text-xs text-slate-500">{s.class} • {s.student_id}</div>
                    </div>
                  )) : (
                    <div>No students yet. Add them via Supabase dashboard or run initial SQL.</div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="col-span-3 space-y-4">
          {selected ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <ScoreForm student={selected} onSaved={onNewScore} />
              </div>
              <div>
                <div className="p-4 bg-white rounded shadow">
                  <h3 className="font-semibold">Summary</h3>
                  <p className="text-sm">Student: {selected.name}</p>
                  <p className="text-sm">Class: {selected.class}</p>
                  <p className="text-sm">Student ID: {selected.student_id}</p>
                </div>
                <div className="mt-4">
                  <Charts scores={scores} />
                </div>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-white rounded shadow">Select a student to begin.</div>
          )}
        </div>
      </div>
    </div>
  )
}
