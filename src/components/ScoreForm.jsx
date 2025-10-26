
import React, {useState} from 'react'
import { supabase } from '../lib/supabaseClient'

export default function ScoreForm({student, onSaved}){
  const [form, setForm] = useState({
    test_date: new Date().toISOString().slice(0,10),
    situps: '', shuttle_run: '', sit_and_reach: '', pullups: '', run_2400: '', broad_jump: ''
  })
  const [saving, setSaving] = useState(false)
  const handle = (e) => setForm({...form, [e.target.name]: e.target.value})

  const save = async () =>{
    setSaving(true)
    const payload = {
      student_id: student.id,
      test_date: form.test_date,
      situps: form.situps ? parseInt(form.situps) : null,
      shuttle_run: form.shuttle_run ? parseFloat(Number(form.shuttle_run).toFixed(1)) : null,
      sit_and_reach: form.sit_and_reach ? parseInt(form.sit_and_reach) : null,
      pullups: form.pullups ? parseInt(form.pullups) : null,
      run_2400: form.run_2400 ? parseFloat(form.run_2400) : null,
      broad_jump: form.broad_jump ? parseInt(form.broad_jump) : null,
    }
    const { data, error } = await supabase.from('scores').insert(payload).select()
    setSaving(false)
    if(error) return alert('Save failed: ' + error.message)
    onSaved && onSaved(data[0])
  }

  return (
    <div className="p-4 bg-white rounded shadow">
      <h3 className="font-semibold mb-2">Add score for {student.name}</h3>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-sm">Test date<input name="test_date" value={form.test_date} onChange={handle} className="w-full p-2 border rounded mt-1" type="date"/></label>
        <label className="text-sm">Sit-ups<div className="text-xs text-gray-600">Unit: reps • Example: 25</div><input name="situps" value={form.situps} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="1" placeholder="e.g., 25"/></label>
        <label className="text-sm">Shuttle run (s)<div className="text-xs text-gray-600">Unit: seconds (1 d.p.) • Example: 10.3</div><input name="shuttle_run" value={form.shuttle_run} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="0.1" placeholder="e.g., 10.3"/></label>
        <label className="text-sm">Sit & Reach (cm)<div className="text-xs text-gray-600">Unit: cm • Example: 32</div><input name="sit_and_reach" value={form.sit_and_reach} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="1" placeholder="e.g., 32"/></label>
        <label className="text-sm">Pull-ups<div className="text-xs text-gray-600">Unit: reps • Example: 8</div><input name="pullups" value={form.pullups} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="1" placeholder="e.g., 8"/></label>
        <label className="text-sm">2.4km run (min)<input name="run_2400" value={form.run_2400} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="0.01"/></label>
        <label className="text-sm">Broad jump (cm)<div className="text-xs text-gray-600">Unit: cm • Example: 190</div><input name="broad_jump" value={form.broad_jump} onChange={handle} className="w-full p-2 border rounded mt-1" type="number" step="1" placeholder="e.g., 190"/></label>
      </div>
      <div className="mt-3 flex gap-2">
        <button onClick={save} className="px-4 py-2 bg-blue-600 text-white rounded" disabled={saving}>{saving? 'Saving...' : 'Save'}</button>
      </div>
    </div>
  )
}
