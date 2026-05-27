'use client'

import { useState } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL

const ALLOWED_EMAILS = [
  'kailaskrsna@cnvrted.com',
  'sharan@cnvrted.com',
  'vishnu@cnvrted.com',
  'dhruv@cnvrted.com',
]

export function OnboardingScreen({ onComplete }: { onComplete: (userId: string, displayName: string, status: string) => void }) {
  const [companyName, setCompanyName] = useState('')
  const [website, setWebsite] = useState('')
  const [workEmail, setWorkEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!workEmail.trim() || !password.trim() || loading) return

    const uname = workEmail.trim().toLowerCase()
    if (!ALLOWED_EMAILS.includes(uname)) {
      setError('Restricted Access.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/users/auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          name: companyName.trim(),
          profession: '',
          password,
        })
      })
      if (res.status === 401) { setError('Incorrect password.'); setLoading(false); return }
      if (res.status === 403) { setError('Only @cnvrted.com emails are allowed.'); setLoading(false); return }
      const user = await res.json()
      const displayName = user.name || user.username
      localStorage.setItem('cnvrted_user_id', user.id)
      localStorage.setItem('cnvrted_user_name', displayName)
      localStorage.setItem('cnvrted_username', user.username)
      localStorage.setItem('cnvrted_user_status', user.status || 'pending')
      onComplete(user.id, displayName, user.status || 'pending')
    } catch (err) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('Backend unreachable, bypassing auth for local testing.', err)
        const displayName = companyName.trim() || uname
        localStorage.setItem('cnvrted_user_id', 'local-test-id')
        localStorage.setItem('cnvrted_user_name', displayName)
        localStorage.setItem('cnvrted_username', uname)
        localStorage.setItem('cnvrted_user_status', 'pending')
        onComplete('local-test-id', displayName, 'pending')
      } else {
        setError('Something went wrong. Try again.')
      }
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#030308] relative overflow-hidden flex items-center justify-center p-8 font-sans">
      <video
        src="/bg-video.mp4"
        className="absolute inset-0 w-full h-full object-cover opacity-70 mix-blend-screen pointer-events-none z-0"
        autoPlay loop muted playsInline
      />
      <div className="absolute top-0 right-0 w-[1000px] h-[800px] bg-indigo-600/10 rounded-full blur-[150px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[150px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

      <div className="w-full max-w-2xl border border-white/5 rounded-[24px] bg-[#07070a]/40 backdrop-blur-2xl relative shadow-[0_0_80px_rgba(0,0,0,0.5)] z-10 overflow-hidden">
        <div className="w-full p-12 md:p-14 flex flex-col justify-center relative">
          <div className="w-full">
            <div className="flex flex-col items-start mb-10">
              <img src="/logo.png" alt="Logo" className="w-[100px] h-auto object-contain mix-blend-screen mb-2" />
              <div className="flex items-center gap-2">
                <span className="text-white font-bold tracking-[0.25em] text-xs uppercase">cnvrted</span>
                <span className="text-[9px] text-white/50 border border-white/20 px-1.5 py-0.5 rounded uppercase tracking-widest font-semibold">BETA</span>
              </div>
            </div>

            <h1 className="text-4xl text-white font-medium mb-3 tracking-tight">{"Let's understand"}<br/>your business first.</h1>
            <p className="text-gray-400 text-[15px] mb-10">This helps us find better buyers for you.</p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-[13px] text-white/90 mb-2 font-medium">Company name <span className="text-red-500">*</span></label>
                  <input type="text" placeholder="e.g. Acme Inc." value={companyName} onChange={e => setCompanyName(e.target.value)}
                    className="w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors" />
                </div>
                <div>
                  <label className="block text-[13px] text-white/90 mb-2 font-medium">Website URL</label>
                  <input type="text" placeholder="e.g. https://acme.com" value={website} onChange={e => setWebsite(e.target.value)}
                    className="w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors" />
                </div>
              </div>

              <div>
                <label className="block text-[13px] text-white/90 mb-2 font-medium">Work email <span className="text-red-500">*</span></label>
                <input type="email" placeholder="you@company.com" value={workEmail} onChange={e => setWorkEmail(e.target.value)}
                  className="w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors" />
              </div>

              <div>
                <label className="block text-[13px] text-white/90 mb-2 font-medium">Password <span className="text-red-500">*</span></label>
                <div className="relative flex items-center">
                  <input type={showPassword ? 'text' : 'password'} placeholder="Create a strong password" value={password} onChange={e => setPassword(e.target.value)}
                    className="w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 pr-10 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-4 text-gray-500 hover:text-gray-300 transition">
                    {showPassword
                      ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      : <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    }
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex justify-end mt-2">
                <button type="submit" disabled={!workEmail.trim() || !password.trim() || loading}
                  className="flex items-center justify-center gap-2 bg-white text-black text-[13px] font-semibold px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50">
                  {loading ? 'Processing...' : 'Continue'}
                  {!loading && <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  )
}
