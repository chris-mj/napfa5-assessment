export default function Dashboard({ user }) {
    return (
        <div className="p-6">
            <h1 className="text-3xl font-semibold mb-3">Dashboard</h1>
            <p className="text-gray-700 mb-4">
                Welcome back, <strong>{user?.email}</strong>!
            </p>
            <p className="text-gray-600">
                Use the navigation bar above to manage schools, users, and NAPFA sessions.
            </p>
        </div>
    );
}
