export default function NotFound() {
    return (
        <div className="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
            <img src="/icon.png" alt="NAPFA5" className="w-16 h-16 mb-4 opacity-80" />
            <h1 className="text-3xl font-semibold mb-2">Page not found</h1>
            <p className="text-gray-600 mb-4">The page you're looking for doesn't exist.</p>
            <a href="/" className="text-blue-600 hover:underline">Back to Home</a>
        </div>
    );
}
