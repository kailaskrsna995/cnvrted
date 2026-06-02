'use client'

import { useState, useRef } from 'react'

const API = process.env.NEXT_PUBLIC_API_URL

function getStrength(pwd: string): { label: string; barColor: string; textColor: string; width: string } {
  if (!pwd) return { label: '', barColor: '', textColor: '', width: '0%' }
  const checks = [pwd.length >= 8, /[A-Z]/.test(pwd) && /[a-z]/.test(pwd), /[0-9]/.test(pwd), /[^A-Za-z0-9]/.test(pwd)]
  const score = checks.filter(Boolean).length
  if (score <= 1) return { label: 'Weak',   barColor: 'bg-red-500',     textColor: 'text-red-500',     width: '25%'  }
  if (score === 2) return { label: 'Fair',   barColor: 'bg-yellow-400',  textColor: 'text-yellow-400',  width: '50%'  }
  if (score === 3) return { label: 'Good',   barColor: 'bg-blue-400',    textColor: 'text-blue-400',    width: '75%'  }
  return              { label: 'Strong', barColor: 'bg-emerald-500',  textColor: 'text-emerald-500', width: '100%' }
}

const EyeIcon = ({ open }: { open: boolean }) => open
  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>

export function OnboardingScreen({ onComplete }: { onComplete: (userId: string, displayName: string, status: string) => void }) {
  const [mode, setMode] = useState<'signup' | 'login'>('signup')

  // Signup state
  const [name,         setName]         = useState('')
  const [companyName,  setCompanyName]  = useState('')
  const [companyUrl,   setCompanyUrl]   = useState('')
  const [companyEmail, setCompanyEmail] = useState('')
  const [role,         setRole]         = useState('')
  const [username,     setUsername]     = useState('')
  const [password,     setPassword]     = useState('')
  const [showPwd,      setShowPwd]      = useState(false)

  // Login state
  const [loginUser,    setLoginUser]    = useState('')
  const [loginPwd,     setLoginPwd]     = useState('')
  const [showLoginPwd, setShowLoginPwd] = useState(false)

  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [showSplash, setShowSplash] = useState(true)
  const [splashFading, setSplashFading] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const strength = getStrength(password)

  const iCls = 'w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors'
  const lCls = 'block text-[12px] text-white/60 mb-2 font-medium uppercase tracking-wider'

  const finish = (user: { id: string; name?: string; username: string }) => {
    const displayName = user.name || user.username
    // Clear any stale session before writing new user data — prevents old
    // name/id bleeding through when switching accounts without logging out.
    localStorage.clear()
    localStorage.setItem('cnvrted_user_id',   user.id)
    localStorage.setItem('cnvrted_user_name', displayName)
    localStorage.setItem('cnvrted_username',  user.username)
    onComplete(user.id, displayName, 'complete')
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !username.trim() || !password.trim() || loading) return
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/users/auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:      username.trim().toLowerCase(),
          password,
          name:          name.trim(),
          profession:    role.trim(),
          company_name:  companyName.trim(),
          company_url:   companyUrl.trim(),
          company_email: companyEmail.trim(),
        }),
      })
      if (res.status === 409) { setError('Username already taken — choose another.'); setLoading(false); return }
      if (res.status === 401) { setError('Incorrect password for that username.'); setLoading(false); return }
      if (!res.ok)            { setError('Something went wrong. Try again.'); setLoading(false); return }
      finish(await res.json())
    } catch {
      setError('Could not reach server. Try again.')
    }
    setLoading(false)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!loginUser.trim() || !loginPwd.trim() || loading) return
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API}/users/auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser.trim().toLowerCase(), password: loginPwd, name: '' }),
      })
      if (res.status === 401) { setError('Incorrect password.'); setLoading(false); return }
      if (res.status === 404) { setError('Account not found.'); setLoading(false); return }
      if (!res.ok)            { setError('Something went wrong. Try again.'); setLoading(false); return }
      finish(await res.json())
    } catch {
      setError('Could not reach server. Try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-[#030308] relative overflow-hidden flex items-center justify-center p-6 font-sans">

      {/* ── Splash / intro video ── */}
      {showSplash && (
        <div className={`fixed inset-0 z-50 bg-[#030308] flex items-center justify-center transition-opacity duration-700 ${splashFading ? 'opacity-0' : 'opacity-100'}`}>
          <video
            ref={videoRef}
            src="/logo_code.mp4"
            className="w-64 h-64 object-contain"
            autoPlay
            muted
            playsInline
            onEnded={() => {
              setSplashFading(true)
              setTimeout(() => setShowSplash(false), 700)
            }}
          />
        </div>
      )}

      <video src="/bg-video.mp4" className="absolute inset-0 w-full h-full object-cover opacity-70 mix-blend-screen pointer-events-none z-0" autoPlay loop muted playsInline />
      <div className="absolute top-0 right-0 w-[1000px] h-[800px] bg-indigo-600/10 rounded-full blur-[150px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[150px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

      <div className="w-full max-w-md border border-white/5 rounded-[24px] bg-[#07070a]/40 backdrop-blur-2xl shadow-[0_0_80px_rgba(0,0,0,0.5)] z-10 overflow-hidden">
        <div className="p-10 flex flex-col max-h-[90vh] overflow-y-auto custom-scrollbar">

          {/* Wordmark */}
          <div className="flex items-center gap-2 mb-8">
            <span className="text-white font-bold tracking-[0.25em] text-sm uppercase">cnvrted</span>
            <span className="text-[9px] text-white/50 border border-white/20 px-1.5 py-0.5 rounded uppercase tracking-widest font-semibold">BETA</span>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 bg-white/5 rounded-xl p-1 mb-8">
            {(['signup', 'login'] as const).map(m => (
              <button key={m} onClick={() => { setMode(m); setError('') }}
                className={`flex-1 text-[13px] font-medium py-2 rounded-lg transition ${mode === m ? 'bg-white text-black' : 'text-gray-400 hover:text-white'}`}>
                {m === 'signup' ? 'Create account' : 'Sign in'}
              </button>
            ))}
          </div>

          {/* ── SIGN UP ── */}
          {mode === 'signup' && (
            <form onSubmit={handleSignup} className="flex flex-col gap-5">

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lCls}>Name <span className="text-red-400">*</span></label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Jane Smith" autoFocus className={iCls} />
                </div>
                <div>
                  <label className={lCls}>Role</label>
                  <input type="text" value={role} onChange={e => setRole(e.target.value)} placeholder="Founder" className={iCls} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lCls}>Company name</label>
                  <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder="Acme Inc." className={iCls} />
                </div>
                <div>
                  <label className={lCls}>Company URL</label>
                  <input type="text" value={companyUrl} onChange={e => setCompanyUrl(e.target.value)} placeholder="acme.com" className={iCls} />
                </div>
              </div>

              <div>
                <label className={lCls}>Company email</label>
                <input type="email" value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="you@company.com" className={iCls} />
              </div>

              <div>
                <label className={lCls}>Username <span className="text-red-400">*</span></label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value.replace(/[^a-z0-9_]/g, '').toLowerCase())}
                  placeholder="jane_smith"
                  className={iCls}
                />
                <p className="text-[11px] text-gray-600 mt-1.5">Lowercase letters, numbers and underscores only.</p>
              </div>

              <div>
                <label className={lCls}>Password <span className="text-red-400">*</span></label>
                <div className="relative flex items-center">
                  <input type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} placeholder="Create a strong password" className={iCls + ' pr-10'} />
                  <button type="button" onClick={() => setShowPwd(v => !v)} className="absolute right-4 text-gray-500 hover:text-gray-300 transition">
                    <EyeIcon open={showPwd} />
                  </button>
                </div>
                {password && (
                  <div className="mt-2">
                    <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full transition-all duration-300 ${strength.barColor}`} style={{ width: strength.width }} />
                    </div>
                    <p className={`text-[11px] mt-1 font-medium ${strength.textColor}`}>{strength.label}</p>
                  </div>
                )}
              </div>

              {error && <p className="text-[13px] text-red-400">{error}</p>}

              <button type="submit" disabled={!name.trim() || !username.trim() || !password.trim() || loading}
                className="flex items-center justify-center gap-2 bg-white text-black text-[13px] font-semibold px-6 py-3 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 mt-1">
                {loading ? 'Creating account…' : 'Get started'}
                {!loading && <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>}
              </button>
            </form>
          )}

          {/* ── SIGN IN ── */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="flex flex-col gap-5">
              <div>
                <label className={lCls}>Username <span className="text-red-400">*</span></label>
                <input type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} placeholder="your_username" autoFocus className={iCls} />
              </div>
              <div>
                <label className={lCls}>Password <span className="text-red-400">*</span></label>
                <div className="relative flex items-center">
                  <input type={showLoginPwd ? 'text' : 'password'} value={loginPwd} onChange={e => setLoginPwd(e.target.value)} placeholder="Your password" className={iCls + ' pr-10'} />
                  <button type="button" onClick={() => setShowLoginPwd(v => !v)} className="absolute right-4 text-gray-500 hover:text-gray-300 transition">
                    <EyeIcon open={showLoginPwd} />
                  </button>
                </div>
              </div>

              {error && <p className="text-[13px] text-red-400">{error}</p>}

              <button type="submit" disabled={!loginUser.trim() || !loginPwd.trim() || loading}
                className="flex items-center justify-center gap-2 bg-white text-black text-[13px] font-semibold px-6 py-3 rounded-xl hover:bg-gray-100 transition-colors disabled:opacity-50 mt-1">
                {loading ? 'Signing in…' : 'Sign in'}
                {!loading && <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
