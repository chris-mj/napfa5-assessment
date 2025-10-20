import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

export default function Students() {
    const [students, setStudents] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

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
                        {students.map(s => (
                            <tr key={s.id}>
                                <td className="border px-3 py-2">{s.student_identifier}</td>
                                <td className="border px-3 py-2">{s.name}</td>
                                <td className="border px-3 py-2">{s.gender}</td>
                                <td className="border px-3 py-2">
                                    {new Date(s.dob).toLocaleDateString('en-SG')}
                                </td>
                            </tr>
                        ))}
                        {students.length === 0 && (
                            <tr>
                                <td colSpan="4" className="border px-3 py-4 text-center text-sm text-gray-500">
                                    No students found. Add students in Supabase → Table Editor → students.
                                </td>
                            </tr>
                        )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}
