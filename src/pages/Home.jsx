import { Link } from 'react-router-dom'

export default function Home() {
  return (
    <div className="max-w-5xl mx-auto px-4 py-10">
      {/* Hero */}
      <section className="text-center space-y-4 py-8">
        <h1 className="text-4xl font-bold tracking-tight">Make NAPFA days feel easy.</h1>
        <p className="text-slate-600 text-lg">From first scan to final export — calm, clear, on time.</p>
        <div className="flex items-center justify-center gap-3 pt-2">
          <Link to="/login" className="px-5 py-2.5 bg-blue-600 text-white rounded hover:bg-blue-700">Sign In</Link>
          <Link to="/contact" className="px-5 py-2.5 border rounded hover:bg-slate-50">Request Access</Link>
        </div>
      </section>

      {/* Feelings */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 py-6">
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Clarity</div>
          <p className="mt-2 text-slate-700">You walk in knowing who’s here, where to start, and what’s next.</p>
        </div>
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Flow</div>
          <p className="mt-2 text-slate-700">Scanning is fluid, scores make sense, and nothing gets in your way.</p>
        </div>
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Confidence</div>
          <p className="mt-2 text-slate-700">You leave with a clean export, no late‑night fixes, and a team in sync.</p>
        </div>
      </section>

      {/* Short story */}
      <section className="py-4">
        <div className="rounded border bg-white p-5">
          <p className="text-slate-800"><span className="font-medium">Before:</span> Papers, second guesses, “we’ll fix later.”</p>
          <p className="text-slate-800 mt-2"><span className="font-medium">During:</span> A steady rhythm — scan, record, move on.</p>
          <p className="text-slate-800 mt-2"><span className="font-medium">After:</span> One download, done. Breathe out.</p>
        </div>
      </section>

      {/* Reassurances */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4 py-6">
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Familiar</div>
          <p className="mt-2 text-slate-700">Works with your school’s setup and devices.</p>
        </div>
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Readable</div>
          <p className="mt-2 text-slate-700">Clear screens in the sun, in the hall, anywhere.</p>
        </div>
        <div className="rounded border bg-white p-4">
          <div className="text-sm uppercase tracking-wide text-slate-500">Private</div>
          <p className="mt-2 text-slate-700">Privacy first, always.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="pt-8 text-center text-sm text-slate-600">
        <div className="flex items-center justify-center gap-4">
          <Link to="/login" className="hover:underline">Sign In</Link>
          <span>·</span>
          <Link to="/contact" className="hover:underline">Contact</Link>
          <span>·</span>
          <a href="#" className="hover:underline" aria-disabled>Privacy</a>
          <span>·</span>
          <a href="#" className="hover:underline" aria-disabled>Terms</a>
        </div>
      </footer>
    </div>
  )
}

