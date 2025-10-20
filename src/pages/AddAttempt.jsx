import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function AddAttempt() {
    const [students, setStudents] = useState([])
    const [sessions, setSessions] = useState([])
    const [stations, setStations] = useState([])

    const [studentId, setStudentId] = useState('')
    const [sessionId, setSessionId] = useState('')
    const [stationId, setStationId] = useState('')
    const [attemptNumber, setAttemptNumber] = useState(1)
    const [value, setValue] = useState('')
    const [unit, setUnit] = useState('')
    const [saving, setSaving] = useState(false)
    const [info, setInfo] = useState(null)
    const [err, setErr] = useState(null)

    useEffect(() => {
        const load = async () => {
            const [stRes, seRes, staRes] = await Promise.all([
                supabase.from('students').select('id, name, student_identifier').order('name'),
                supabase.from('sessions').select('id, title, session_date').order('session_date', { ascending: false }),
                supabase.from('stations').select('id, name, unit, max_attempts, order_index').order('order_index')
            ])
            if (stRes.error) setErr(stRes.error.message); else setStudents(stRes.data || [])
            if (seRes.error) setErr(seRes.error.message); else setSessions(seRes.data || [])
            if (staRes.error) setErr(staRes.error.message); else setStations(staRes.data || [])
        }
        load()
    }, [])

    // Auto-fill unit and clamp attempt number when station changes
    const selectedStation = useMemo(() => stations.find(s => s.id === stationId), [stationId, stations])
    useEffect(() => {
        if (selectedStation) {
            setUnit(selectedStation.unit || '')
            if (attemptNumber > (selectedStation.max_attempts || 1)) {
                setAttemptNumber(1)
            }
        }
    }, [selectedStation]) // eslint-disable-line

    const submit = async (e) => {
        e.preventDefault()
        setInfo(null); setErr(null)

        if (!studentId || !sessionId || !stationId || !value) {
            setErr('Please select student, session, station and enter a value.')
            return
        }
        const v = Number(value)
        if (Number.isNaN(v)) {
            setErr('Score value must be a number.')
            return
        }

        setSaving(true)
        const { error } = await supabase.from('attempts').insert([{
            student_id: studentId,
            session_id: sessionId,
            station_id: stationId,
            attempt_number: attemptNumber,
            value: v,
            unit: unit || null
        }])
        setSaving(false)

        if (error) setErr(error.message)
        else {
            setInfo('✅ Attempt recorded')
            // keep student/session/station, just clear value
            setValue('')
        }
    }

    return (
        <div className="p-6 max-w-2xl">
            <h1 className="text-2xl font-bold mb-4">Record Attempt</h1>

            {err && <div className="mb-3 text-sm text-red-600">Error: {err}</div>}
            {info && <div className="mb-3 text-sm text-green-700">{info}</div>}

            <form onSubmit={submit} className="space-y-4">
                <div>
                    <label className="block text-sm mb-1">Student</label>
                    <select value={studentId} onChange={e => setStudentId(e.target.value)} className="border rounded p-2 w-full">
                        <option value="">— select student —</option>
                        {students.map(s => (
                            <option key={s.id} value={s.id}>
                                {s.name} ({s.student_identifier})
                            </option>
                        ))}
                    </select>
                </div>

                <div>
                    <label className="block text-sm mb-1">Session</label>
                    <select value={sessionId} onChange={e => setSessionId(e.target.value)} className="border rounded p-2 w-full">
                        <option value="">— select session —</option>
                        {sessions.map(se => (
                            <option key={se.id} value={se.id}>
                                {se.title} — {new Date(se.session_date).toLocaleDateString('en-SG')}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="block text-sm mb-1">Station</label>
                        <select value={stationId} onChange={e => setStationId(e.target.value)} className="border rounded p-2 w-full">
                            <option value="">— select station —</option>
                            {stations.map(st => (
                                <option key={st.id} value={st.id}>
                                    {st.name} ({st.unit})
                                </option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Attempt #</label>
                        <select
                            value={attemptNumber}
                            onChange={e => setAttemptNumber(Number(e.target.value))}
                            className="border rounded p-2 w-full"
                            disabled={!selectedStation}
                        >
                            {Array.from({ length: selectedStation?.max_attempts || 1 }).map((_, i) => (
                                <option key={i+1} value={i+1}>{i+1}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm mb-1">Value ({unit || '—'})</label>
                        <input
                            type="text"
                            value={value}
                            onChange={e => setValue(e.target.value)}
                            placeholder={selectedStation?.unit === 's' ? 'e.g. 10.3' : 'e.g. 42 or 190'}
                            className="border rounded p-2 w-full"
                        />
                    </div>
                </div>

                <button
                    type="submit"
                    disabled={saving}
                    className="bg-blue-600 hover:bg-blue-700 text-white rounded px-4 py-2"
                >
                    {saving ? 'Saving…' : 'Save Attempt'}
                </button>
            </form>
        </div>
    )
}
