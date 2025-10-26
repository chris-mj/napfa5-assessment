import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Students() {
    const [students, setStudents] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)
    const [page, setPage] = useState(1)
    const [pageSize, setPageSize] = useState(100)

    useEffect(() => {
        const load = async () => {
            setLoading(true)
            setError(null)
            const { data, error } = await supabase
                .from('students')
                .select('id, student_identifier, name, gender, dob')
                .order('name', { ascending: true })

            if (error) setError(error.message)
            else setStudents(data || [])
            setLoading(false)
        }
        load()
    }, [])

    useEffect(() => {
        const calc = () => setPageSize(window.innerWidth < 768 ? 40 : 100)
        calc()
        window.addEventListener('resize', calc)
        return () => window.removeEventListener('resize', calc)
    }, [])

    const paged = useMemo(() => {
        const total = students.length
        const totalPages = Math.max(1, Math.ceil(total / pageSize))
        const cur = Math.min(page, totalPages)
        const start = (cur - 1) * pageSize
        return { cur, totalPages, items: students.slice(start, start + pageSize), total }
    }, [students, page, pageSize])

    const formatDob = (d) => {
        if (!d) return '-'
        try {
            const dt = new Date(d)
            const dd = String(dt.getDate()).padStart(2,'0')
            const mm = String(dt.getMonth()+1).padStart(2,'0')
            const yyyy = dt.getFullYear()
            return `${dd}/${mm}/${yyyy}`
        } catch { return '-' }
    }

    return (
        <div className="p-6">
            <h1 className="text-2xl font-bold mb-4">Students</h1>

            {loading && <div className="text-sm">Loading…</div>}
            {error && <div className="text-sm text-red-600">Error: {error}</div>}

            {!loading && !error && (
                <div className="overflow-x-auto">
                    <table className="min-w-[720px] w-full border rounded">
                        <thead>
                        <tr className="bg-gray-100 text-left">
                            <th className="border px-3 py-2">Student ID</th>
                            <th className="border px-3 py-2">Name</th>
                            <th className="border px-3 py-2">Gender</th>
                            <th className="border px-3 py-2">DOB</th>
                        </tr>
                        </thead>
                        <tbody>
                        {paged.items.map(s => (
                            <tr key={s.id}>
                                <td className="border px-3 py-2">{s.student_identifier}</td>
                                <td className="border px-3 py-2">{s.name}</td>
                                <td className="border px-3 py-2">{s.gender}</td>
                                <td className="border px-3 py-2">{formatDob(s.dob)}</td>
                            </tr>
                        ))}
                        {students.length === 0 && (
                            <tr>
                                                                <td colSpan="4" className="border px-3 py-6 text-center text-sm text-gray-500">
                                    <div className="flex flex-col items-center gap-2">
                                        <img src="/icon.png" alt="No students" className="w-10 h-10 opacity-80" />
                                        <div>
                                            No students found. Add students in Supabase &rarr; Table Editor &rarr; students.
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
            )}
            {!!students.length && (
                <div className="flex items-center justify-between text-sm mt-2">
                    <div>Showing {(paged.cur-1)*pageSize + 1}–{Math.min(paged.cur*pageSize, paged.total)} of {paged.total}</div>
                    <div className="flex items-center gap-2">
                        <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur<=1} onClick={()=>setPage(p=>Math.max(1, p-1))}>Prev</button>
                        <div>Page {paged.cur} / {paged.totalPages}</div>
                        <button className="px-2 py-1 border rounded disabled:opacity-50" disabled={paged.cur>=paged.totalPages} onClick={()=>setPage(p=>Math.min(paged.totalPages, p+1))}>Next</button>
                    </div>
                </div>
            )}
        </div>
    )
}
