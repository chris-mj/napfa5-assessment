import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

export default function Home() {
  const sectionVariants = {
    hidden: { opacity: 0, y: 16 },
    show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: 'easeOut' } }
  }
  const staggerParent = {
    hidden: {},
    show: { transition: { staggerChildren: 0.06, delayChildren: 0.06 } }
  }
  const itemVariants = {
    hidden: { opacity: 0, y: 12 },
    show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: 'easeOut' } }
  }
  return (
    <div className="bg-[#F9FAFB] font-sans">
      <main className="max-w-6xl mx-auto px-4 py-10 space-y-8 md:space-y-12">
        {/* Hero Banner */}
        <motion.section className="relative overflow-hidden" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="bg-gradient-to-r from-blue-50 via-sky-50 to-indigo-50">
            <div className="max-w-6xl mx-auto px-4 py-20">
              <div className="grid md:grid-cols-2 gap-8 items-center">
                <div className="text-left">
                  <div className="flex items-center gap-2 mb-2">
                    <img src="/icon.png" alt="NAPFA 5" className="h-8 w-8 rounded" loading="lazy" decoding="async" />
                    <span className="text-sm font-semibold text-[#0F172A]">NAPFA 5</span>
                  </div>
                  <h1 className="text-5xl md:text-6xl font-bold tracking-tight leading-tight text-[#0F172A]">Simplify Your School's NAPFA Assessments</h1>
                  <p className="text-[#64748B] text-lg mt-4 max-w-3xl">Digital, secure, and effortless — the smarter way to manage physical fitness tests.</p>
                  <div className="flex flex-wrap items-center gap-3 pt-6">
                    <Link to="/contact" className="px-6 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/30">Request a Trial</Link>
                    <Link to="/login" className="px-6 py-3 rounded-xl bg-white text-blue-700 border border-blue-100 hover:bg-blue-50 shadow-md active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/20">Login</Link>
                  </div>
                  <div className="text-sm text-[#64748B] mt-4">Used by PE departments across Singapore schools.</div>
                </div>
                <div aria-hidden className="relative">
                  <div className="absolute -top-6 -right-6 h-24 w-24 rounded-full bg-blue-200/30 blur-2xl" />
                  <DeviceFrame>
                    <img src="/viewresults.png" alt="Today's sessions mockup" className="w-full h-full object-cover" loading="lazy" decoding="async" />
                  </DeviceFrame>
                </div>
              </div>
            </div>
          </div>
        </motion.section>

        {/* Credibility Layer */}
        <motion.section className="rounded-2xl bg-slate-50 p-6 md:p-8" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#0F172A]">Trusted by schools and educators.</h2>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-6 opacity-90">
              <img src="/napfa5 blue.png" alt="NAPFA 5" className="h-10 w-10 rounded-full ring-1 ring-gray-200/60" loading="lazy" decoding="async" />
              <img src="/napfa5 yellow.png" alt="NAPFA 5" className="h-10 w-10 rounded-full ring-1 ring-gray-200/60" loading="lazy" decoding="async" />
              <img src="/napfa5 orange.png" alt="NAPFA 5" className="h-10 w-10 rounded-full ring-1 ring-gray-200/60" loading="lazy" decoding="async" />
              <img src="/napfa5 red.png" alt="NAPFA 5" className="h-10 w-10 rounded-full ring-1 ring-gray-200/60" loading="lazy" decoding="async" />
              <img src="/napfa5 purple.png" alt="NAPFA 5" className="h-10 w-10 rounded-full ring-1 ring-gray-200/60" loading="lazy" decoding="async" />
            </div>
            {/*<div className="mt-4 text-sm text-[#64748B] leading-relaxed max-w-2xl mx-auto">*/}
            {/*  “Scanning is smooth and the exports just work.” — PE Teacher, Primary School*/}
            {/*</div>*/}
          </div>
        </motion.section>

        {/* Problem -> Solution */}
        <motion.section className="relative rounded-2xl bg-slate-50/60 p-4 md:p-6" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-2 text-[#64748B] text-xs uppercase tracking-wide font-semibold mb-2">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-red-50 text-red-600">❌</span>
                The Old Way
              </div>
              <OldNewList items={[
                'Paper forms and manual ID entry',
                'End-of-day cleanup and reformatting',
                'Unclear status of who has completed what'
              ]} />
            </div>
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
              <div className="flex items-center gap-2 text-[#64748B] text-xs uppercase tracking-wide font-semibold mb-2">
                <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-emerald-50 text-emerald-600">✅</span>
                The NAPFA 5 Way
              </div>
              <OldNewList check items={[
                'Scan cards or type — instant search with live checks',
                'Reliable transfer between Cockpit and NAPFA-5',
                '1-touch reports that match school-ready PFT formats'
              ]} />
            </div>
          </div>
          <div className="hidden md:block absolute top-6 bottom-6 left-1/2 -translate-x-1/2 w-px bg-gray-200" />
        </motion.section>

        {/* Feature Highlights */}
        <motion.section initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="text-center mb-6">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#0F172A]">Highlights</h2>
            <p className="text-[#64748B] max-w-3xl mx-auto leading-relaxed">Simple tools that feel fast and familiar.</p>
          </div>
          <motion.div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 md:gap-8" variants={staggerParent} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconSmartData />} title="Smart Data" text="Clean, consistent student & session info." /></motion.div>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconScoring />} title="Seamless Scoring" text="Mobile-friendly score entry with live checks." /></motion.div>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconReports />} title="Instant Reports" text="1-touch PFT exports that match templates." /></motion.div>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconCloudSecure />} title="Secure Supabase cloud database" text="Privacy-first by design; works on school devices." /></motion.div>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconRoles />} title="Role-based access" text="Teachers & admins have the right controls." /></motion.div>
            <motion.div variants={itemVariants}><FeatureCard icon={<IconAwards />} title="Auto-generated results & awards" text="Standards-based grading and awards, computed instantly." /></motion.div>
          </motion.div>
        </motion.section>

        {/* Visual Showcase */}
        <motion.section className="space-y-6" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#0F172A]">See it in action</h2>
            <p className="text-[#64748B] max-w-3xl mx-auto leading-relaxed">A quick look at the flow on NAPFA day.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            <ShowcaseCard title="Teacher Dashboard" caption="Know what's running and what's next." benefit="Plan sessions with confidence" />
            <ShowcaseCard title="Score Entry" caption="Mobile-friendly, with live validation." benefit="Record scores up to 60% faster" />
            <ShowcaseCard title="Results Export" caption="1-touch PFT CSVs, class or whole cohort." benefit="Ready for submission, no reformatting" />
          </div>
        </motion.section>

        {/* Testimonials / Social Proof (temporarily hidden) */}
        {/**
        <motion.section className="space-y-6 py-8 md:py-12" initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }} variants={sectionVariants}>
          <div className="text-center">
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#0F172A]">Teachers on NAPFA-5</h2>
            <p className="text-[#64748B] max-w-3xl mx-auto leading-relaxed">Trusted by schools focused on clarity and time savings.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
            <TestimonialCard quote="This cut our admin time in half!" name="Head of PE" school="Secondary School" />
            <TestimonialCard quote="Scanning is smooth and the exports just work." name="PE Teacher" school="Primary School" />
            <TestimonialCard quote="We ended the day with zero re-typing." name="PE Coordinator" school="Junior College" />
          </div>
          <div className="flex items-center justify-center gap-2 text-slate-600 text-sm">
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200" aria-hidden></span>
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200" aria-hidden></span>
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200" aria-hidden></span>
            <span className="inline-flex items-center justify-center h-6 w-6 rounded-full bg-slate-200" aria-hidden></span>
            <span className="ml-2">Trusted by 20+ schools</span>
          </div>
        </motion.section>
        **/}

        {/* Call-to-Action Band */}
        <section className="rounded-2xl bg-slate-900 text-white p-6 md:p-8 text-center shadow-md">
          <h2 className="text-2xl md:text-3xl font-bold">Bring simplicity to your next NAPFA session.</h2>
          <p className="text-white/80 mt-2">Set up in minutes. Scan, score, export — without the chaos.</p>
          <div className="mt-4 flex items-center justify-center gap-3">
            <Link to="/contact" className="px-5 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 shadow-md hover:shadow-lg active:shadow-sm active:translate-y-[1px]">Request a Trial</Link>
            <Link to="/login" className="px-5 py-2.5 rounded-xl border border-white/60 text-white hover:bg-white/10">Login</Link>
          </div>
        </section>

        {/* Footer */}
        <footer className="py-8 text-center text-sm bg-slate-50 rounded-2xl">
          {/*<div className="flex items-center justify-center gap-2 text-[#0F172A] mb-2">*/}
          {/*  <img src="/icon.png" alt="NAPFA 5" className="h-5 w-5" />*/}
          {/*  <span>Built for Singapore schools</span>*/}
          {/*</div>*/}
          <div className="text-[#64748B] flex items-center justify-center gap-4">
            <Link to="/about" className="hover:underline">About</Link>
            <span>•</span>
            <Link to="/privacy" className="hover:underline">Privacy</Link>
            <span>•</span>
            <Link to="/contact" className="hover:underline">Contact</Link>
          </div>
        </footer>
      </main>
    </div>
  )
}

function FeatureCard({ icon, title, text }) {
  return (
    <div className="bg-white rounded-xl shadow-sm p-6 transition-all hover:shadow-md hover:-translate-y-0.5">
      <div className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-blue-50 mb-3">
        {icon}
      </div>
      <div className="text-base font-semibold text-[#0F172A]">{title}</div>
      <div className="mt-1 text-sm text-[#64748B] leading-relaxed">{text}</div>
    </div>
  )
}

// Simple inline icons
function IconSmartData({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v6c0 1.7 3.1 3 7 3s7-1.3 7-3V5" />
      <path d="M5 11v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" />
    </svg>
  )
}

function IconReports({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </svg>
  )
}

function IconScoring({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
    </svg>
  )
}

function IconCloudSecure({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M18 10a4 4 0 0 0-7.9-1" />
      <path d="M5 15a4 4 0 0 0 0 8h10a4 4 0 0 0 0-8H5z" />
      <rect x="9" y="15" width="6" height="5" rx="1" />
      <path d="M12 15v-2a2 2 0 1 1 4 0v2" />
    </svg>
  )
}

function IconRoles({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function IconAwards({ className = "w-6 h-6 text-blue-600" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M8 22h8" />
      <path d="M12 22v-4" />
      <path d="M7 10a5 5 0 0 1-5-5V3h5" />
      <path d="M17 10a5 5 0 0 0 5-5V3h-5" />
      <path d="M7 3h10v5a5 5 0 0 1-10 0V3Z" />
    </svg>
  )
}

function ShowcaseCard({ title, caption, benefit }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white overflow-hidden shadow-md hover:shadow-lg transition-shadow">
      <DeviceFrame>
        <img src={title === 'Teacher Dashboard' ? '/sessiondetail.png' : title === 'Score Entry' ? '/scoreentry.png' : '/scorecalculate.png'} alt={title} className="w-full h-full object-cover" loading="lazy" decoding="async" />
      </DeviceFrame>
      <div className="p-4">
        <div className="text-sm font-medium text-[#0F172A]">{title}</div>
        <div className="text-sm text-[#64748B] mt-0.5 leading-relaxed">{caption}</div>
        {benefit && <div className="mt-2 inline-flex items-center rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-xs">{benefit}</div>}
      </div>
    </div>
  )
}

function TestimonialCard({ quote, name, school }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-md">
      <div className="text-[#0F172A] leading-relaxed">"{quote}"</div>
      <div className="text-sm text-[#64748B] mt-2">{name} · {school}</div>
    </div>
  )
}

function DeviceFrame({ children }) {
  return (
    <div className="aspect-video bg-white">
      {/*<div className="h-6 bg-slate-100 border-b border-slate-200 flex items-center justify-center text-[10px] text-slate-500"></div>*/}
      <div className="h-[calc(100%-1.5rem)] bg-slate-50 flex items-center justify-center overflow-hidden">
        <div className="w-full h-full">{children}</div>
      </div>
    </div>
  )
}

function OldNewList({ items = [], check = false }) {
  return (
    <ul className="space-y-2.5">
      {items.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-slate-700 text-sm leading-relaxed">
          {check ? (
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-slate-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1"/></svg>
          )}
          <span className="leading-relaxed">{t}</span>
        </li>
      ))}
    </ul>
  )
}
