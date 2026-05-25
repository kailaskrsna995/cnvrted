'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const API = process.env.NEXT_PUBLIC_API_URL

type Lead = {
  id: string
  lead_id: string
  author: string
  profession: string
  company: string
  domain: string
  post_text: string
  exact_need: string
  category: string
  intent_score: number
  timeline: string
  source_url: string
  contact_email: string
  contact_phone: string
  contact_linkedin: string
  ingested_at: string
  posted_at: string | null
  platform?: string
  tokens_used?: number
  location?: string
}

type ActiveSearch = { domain: string; keywords: string[] }

type ScanStats = {
  total_scanned: number
  total_rejected: number
  total_saved: number
}

function scoreColor(score: number) {
  if (score >= 80) return 'bg-black text-white'
  if (score >= 60) return 'bg-gray-700 text-white'
  return 'bg-gray-200 text-gray-700'
}

function timelineColor(timeline: string) {
  if (timeline === 'Urgent') return 'text-red-500'
  if (timeline === 'Active') return 'text-amber-500'
  return 'text-gray-400'
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isOlderThan24h(iso: string | null): boolean {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) > 24 * 60 * 60 * 1000
}

function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const INDUSTRIES = ['E-commerce', 'SaaS / Tech', 'Healthcare', 'Finance', 'Real Estate', 'Logistics', 'Education', 'Other']
const SIZES = ['SMB (1–50)', 'Mid-market (50–500)', 'Enterprise (500+)', 'All sizes']

function PreferencesScreen({ userId, onComplete }: {
  userId: string
  onComplete: (serviceOffering: string, industries: string[]) => void
}) {
  const [serviceOffering, setServiceOffering] = useState('')
  const [selectedIndustries, setSelectedIndustries] = useState<string[]>([])
  const [companySize, setCompanySize] = useState('')
  const [loading, setLoading] = useState(false)

  const toggleIndustry = (ind: string) => {
    setSelectedIndustries(prev =>
      prev.includes(ind) ? prev.filter(i => i !== ind) : [...prev, ind]
    )
  }

  const handleSubmit = async () => {
    if (!serviceOffering.trim() || !companySize || loading) return
    setLoading(true)
    try {
      await fetch(`${API}/users/${userId}/preferences/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_offering: serviceOffering.trim(),
          target_industries: selectedIndustries,
          company_size: companySize,
        })
      })
    } catch {}
    onComplete(serviceOffering.trim(), selectedIndustries)
    setLoading(false)
  }

  return (
    <div className="h-screen bg-white flex flex-col items-center justify-center px-8">
      <div className="w-full max-w-lg">
        <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-black block mb-10">cnvrted</span>
        <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-2">One-time setup</p>
        <h1 className="font-canela text-4xl font-light text-black mb-10">Personalise your feed.</h1>

        <div className="mb-8">
          <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-3">
            What service do you offer?
          </label>
          <input
            type="text"
            value={serviceOffering}
            onChange={e => setServiceOffering(e.target.value)}
            placeholder="e.g. AI automation agency, Facebook ads, SaaS development"
            autoFocus
            className="font-canela text-base w-full border border-black/20 bg-white px-3 py-2.5 outline-none focus:border-black transition-all duration-150"
          />
        </div>

        <div className="mb-8">
          <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-3">
            Who are your ideal clients? <span className="text-gray-300 normal-case">(select all that apply)</span>
          </label>
          <div className="flex flex-wrap gap-2">
            {INDUSTRIES.map(ind => (
              <button
                key={ind}
                onClick={() => toggleIndustry(ind)}
                className={`font-mono-custom text-xs px-3 py-1.5 border transition-all duration-150 uppercase tracking-wide
                  ${selectedIndustries.includes(ind)
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-500 border-black/20 hover:border-black'}`}
              >
                {ind}
              </button>
            ))}
          </div>
        </div>

        <div className="mb-10">
          <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-3">
            What size companies do you target?
          </label>
          <div className="flex flex-wrap gap-2">
            {SIZES.map(size => (
              <button
                key={size}
                onClick={() => setCompanySize(size)}
                className={`font-mono-custom text-xs px-3 py-1.5 border transition-all duration-150 uppercase tracking-wide
                  ${companySize === size
                    ? 'bg-black text-white border-black'
                    : 'bg-white text-gray-500 border-black/20 hover:border-black'}`}
              >
                {size}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={handleSubmit}
          disabled={!serviceOffering.trim() || !companySize || loading}
          className="font-mono-custom w-full border border-black bg-black text-white text-xs px-3 py-2.5 uppercase tracking-widest hover:bg-gray-900 hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 disabled:opacity-40 disabled:translate-y-0 disabled:shadow-none"
        >
          {loading ? 'Saving...' : 'Build my feed →'}
        </button>
      </div>
    </div>
  )
}

function PostPreviewModal({ lead, onClose }: { lead: Lead, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-black/20 flex items-center justify-center font-canela text-base font-medium shrink-0">
              {lead.author?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-canela text-base font-medium text-black">{lead.author}</p>
              {lead.profession && <p className="font-mono-custom text-xs text-gray-400 mt-0.5">{lead.profession}</p>}
            </div>
          </div>
          <button onClick={onClose} className="font-mono-custom text-xs text-gray-400 hover:text-black transition">✕</button>
        </div>

        <div className="px-6 py-5 max-h-96 overflow-y-auto">
          {lead.exact_need && (
            <div className="border-l-2 border-black pl-3 mb-4">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Looking for</p>
              <p className="font-canela text-base text-black">{lead.exact_need}</p>
            </div>
          )}
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{lead.post_text}</p>
        </div>

        <div className="px-6 py-4 border-t border-black/10 flex justify-between items-center">
          <span className="font-mono-custom text-xs text-gray-400">{formatDate(lead.posted_at || lead.ingested_at)}</span>
          {lead.source_url ? (
            <a
              href={lead.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono-custom text-xs border border-black bg-black text-white px-4 py-2 hover:bg-gray-900 transition"
            >
              {lead.platform === 'reddit' ? 'Open on Reddit ↗' : lead.platform === 'twitter' ? 'Open on X ↗' : 'Open on LinkedIn ↗'}
            </a>
          ) : (
            <span className="font-mono-custom text-xs text-gray-300">No source URL</span>
          )}
        </div>
      </div>
    </div>
  )
}

const ALLOWED_EMAILS = [
  'kailaskrsna@cnvrted.com',
  'sharan@cnvrted.com',
  'vishnu@cnvrted.com',
  'dhruv@cnvrted.com',
]

function OnboardingScreen({ onComplete }: { onComplete: (userId: string, displayName: string, status: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const rightPanelRef = useRef<HTMLDivElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const panel = rightPanelRef.current
    const grid = gridRef.current
    if (!panel || !grid) return
    const handleMouseMove = (e: MouseEvent) => {
      const rect = panel.getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width - 0.5
      const y = (e.clientY - rect.top) / rect.height - 0.5
      grid.style.transform = `translate(${x * 10}px, ${y * 10}px)`
    }
    panel.addEventListener('mousemove', handleMouseMove)
    return () => panel.removeEventListener('mousemove', handleMouseMove)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim() || loading) return

    const uname = username.trim().toLowerCase()
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
          name: '',
          profession: '',
          password
        })
      })
      if (res.status === 401) {
        setError('Incorrect password.')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError('Only @cnvrted.com emails are allowed.')
        setLoading(false)
        return
      }
      const user = await res.json()
      const displayName = user.name || user.username
      localStorage.setItem('cnvrted_user_id', user.id)
      localStorage.setItem('cnvrted_user_name', displayName)
      localStorage.setItem('cnvrted_username', user.username)
      localStorage.setItem('cnvrted_user_status', user.status || 'pending')
      onComplete(user.id, displayName, user.status || 'pending')
    } catch {
      setError('Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <>
      <style>{`
        @keyframes grain {
          0%,100% { transform: translate(0,0) }
          10% { transform: translate(-2%,-1%) }
          20% { transform: translate(1%,2%) }
          30% { transform: translate(-1%,1%) }
          40% { transform: translate(2%,-2%) }
          50% { transform: translate(-1%,2%) }
          60% { transform: translate(1%,-1%) }
          70% { transform: translate(-2%,1%) }
          80% { transform: translate(2%,2%) }
          90% { transform: translate(-1%,-2%) }
        }
        @keyframes glow-drift {
          0%,100% { transform: translate(-50%,-50%) scale(1) }
          33% { transform: translate(-44%,-56%) scale(1.06) }
          66% { transform: translate(-56%,-44%) scale(0.95) }
        }
        @keyframes breathe {
          0%,100% { opacity: 0.08 }
          50% { opacity: 0.18 }
        }
      `}</style>
      <div className="h-screen flex">

        {/* Left — black brand panel */}
        <div className="relative w-1/2 flex flex-col justify-between p-12 bg-black overflow-hidden">
          {/* Grain */}
          <div style={{
            position:'absolute', inset:'-50%', width:'200%', height:'200%',
            backgroundImage:`url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.75' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
            opacity:0.045, animation:'grain 8s steps(10) infinite', pointerEvents:'none'
          }} />
          {/* Radial glow */}
          <div style={{
            position:'absolute', top:'50%', left:'45%',
            width:'70%', height:'70%',
            background:'radial-gradient(circle, rgba(255,255,255,0.07) 0%, transparent 70%)',
            animation:'glow-drift 14s ease-in-out infinite', pointerEvents:'none'
          }} />
          {/* Breathing blur */}
          <div style={{
            position:'absolute', inset:0,
            backdropFilter:'blur(0.4px)',
            animation:'breathe 7s ease-in-out infinite', pointerEvents:'none'
          }} />

          <span className="relative font-mono-custom text-sm font-bold tracking-widest uppercase text-white">cnvrted</span>
          <div className="relative">
            <h1 className="font-canela text-5xl font-light text-white leading-tight mb-4">
              Your buyers are<br />already talking.
            </h1>
            <p className="font-mono-custom text-xs text-white/40 uppercase tracking-widest leading-relaxed">
              Intent signals from LinkedIn,<br />scored by AI in real time
            </p>
          </div>
          <p className="relative font-mono-custom text-xs text-white/20 uppercase tracking-widest">Est. 2026</p>
        </div>

        {/* Right — form */}
        <div ref={rightPanelRef} className="relative w-1/2 flex items-center justify-center bg-white overflow-hidden">
          {/* Parallax grid */}
          <div ref={gridRef} className="absolute inset-[-10%] w-[120%] h-[120%] grid-bg transition-transform duration-100 ease-out" style={{ opacity:0.55 }} />

          <div className="relative w-full max-w-sm px-8">
            <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-2">Get started</p>
            <h2 className="font-canela text-3xl font-light text-black mb-8">Set up your workspace.</h2>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">

              <div>
                <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-1.5">Work Email</label>
                <input
                  type="text" value={username} onChange={e => setUsername(e.target.value)}
                  placeholder="e.g. name@cnvrted.com" autoFocus
                  className="font-canela text-base w-full border border-black/20 bg-white/90 px-3 py-2 outline-none focus:border-black focus:-translate-y-px transition-all duration-150"
                />
              </div>

              <div>
                <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="Choose a password"
                    className="font-canela text-base w-full border border-black/20 bg-white/90 px-3 py-2 pr-10 outline-none focus:border-black focus:-translate-y-px transition-all duration-150"
                  />
                  <button
                    type="button" tabIndex={-1}
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-300 hover:text-black transition-colors duration-150"
                  >
                    {showPassword ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {error && (
                <p className={`font-mono-custom text-xs uppercase tracking-widest ${error.startsWith('Restricted') ? 'text-red-600 font-bold' : 'text-red-500'}`}>
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={!username.trim() || !password.trim() || loading}
                className="font-mono-custom mt-2 w-full border border-black bg-black text-white text-xs px-3 py-2.5 uppercase tracking-widest hover:bg-gray-900 hover:-translate-y-0.5 hover:shadow-md transition-all duration-150 disabled:opacity-40 disabled:translate-y-0 disabled:shadow-none"
              >
                {loading ? 'Setting up...' : 'Enter →'}
              </button>

              <p className="font-mono-custom text-xs text-gray-400 text-center">
                Returning? Enter your email + password to sign back in.
              </p>
            </form>
          </div>
        </div>

      </div>
    </>
  )
}

function ProfileModal({ userName, userPosition, savedLeadIds, onClose, onLogout }: {
  userName: string
  userPosition: string
  savedLeadIds: Set<string>
  onClose: () => void
  onLogout: () => void
}) {
  const [savedLeads, setSavedLeads] = useState<Lead[]>([])

  useEffect(() => {
    if (savedLeadIds.size === 0) { setSavedLeads([]); return }
    supabase.from('leads').select('*').in('lead_id', [...savedLeadIds]).order('ingested_at', { ascending: false })
      .then(({ data }) => setSavedLeads(data || []))
  }, [savedLeadIds])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="w-96 bg-white border-l border-black/10 flex flex-col h-full overflow-hidden">
        <div className="px-6 py-5 border-b border-black/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-black flex items-center justify-center font-canela text-white text-base">
              {userName[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-canela text-base font-medium text-black leading-tight">{userName}</p>
              <p className="font-mono-custom text-xs text-gray-400 mt-0.5">
                @{typeof window !== 'undefined' ? localStorage.getItem('cnvrted_username') || '' : ''}
                {userPosition ? ` · ${userPosition}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              className="font-mono-custom text-xs text-red-400 hover:text-red-600 uppercase tracking-widest transition"
            >
              Log out
            </button>
            <button onClick={onClose} className="font-mono-custom text-xs text-gray-400 hover:text-black uppercase tracking-widest transition">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 pb-5 border-b border-black/10">
            <div className="flex justify-between items-center mb-2">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">Credits</p>
              <p className="font-mono-custom text-xs text-gray-400">0 / 100</p>
            </div>
            <div className="w-full h-1 bg-gray-100">
              <div className="h-1 bg-black transition-all" style={{ width: '0%' }} />
            </div>
            <p className="font-mono-custom text-xs text-gray-300 mt-1.5">Payments coming soon</p>
          </div>

          <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-4">
            Saved — {savedLeadIds.size}
          </p>
          {savedLeads.length === 0 ? (
            <p className="font-mono-custom text-xs text-gray-300 uppercase tracking-widest">No saved leads yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {savedLeads.map(lead => (
                <div key={lead.id} className="border border-black/10 p-4 hover:border-black/30 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-canela text-sm font-medium text-black">{lead.author}</p>
                      {lead.profession && <p className="font-mono-custom text-xs text-gray-400 mt-0.5">{lead.profession}</p>}
                    </div>
                    <span className={`font-mono-custom text-xs px-1.5 py-0.5 font-bold shrink-0 ${scoreColor(lead.intent_score)}`}>
                      {lead.intent_score}
                    </span>
                  </div>
                  {lead.exact_need && (
                    <p className="font-canela text-sm text-gray-700 line-clamp-2">{lead.exact_need}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [userPosition, setUserPosition] = useState('')
  const [ready, setReady] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [category, setCategory] = useState('All')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanStats, setScanStats] = useState<ScanStats>({ total_scanned: 0, total_rejected: 0, total_saved: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeSearch, setActiveSearch] = useState<ActiveSearch | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const [preferencesSet, setPreferencesSet] = useState<boolean | null>(null)
  const [suggestedDomains, setSuggestedDomains] = useState<string[]>([])
  const [previewLead, setPreviewLead] = useState<Lead | null>(null)
  const [revealedContacts, setRevealedContacts] = useState<Set<string>>(new Set())
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (scanPollRef.current) clearInterval(scanPollRef.current) }
  }, [])

  useEffect(() => {
    const id = localStorage.getItem('cnvrted_user_id')
    const name = localStorage.getItem('cnvrted_user_name')
    if (id) {
      setUserId(id)
      if (name) setUserName(name)
      fetchUser(id)
      fetchSaved(id)
    }
    setReady(true)
  }, [])

  // On mount, check if scan is already running (e.g. page refresh mid-scan)
  useEffect(() => {
    if (!ready) return
    fetch(`${API}/ingest/status/`)
      .then(r => r.json())
      .then(data => {
        setScanStats({ total_scanned: data.total_scanned, total_rejected: data.total_rejected, total_saved: data.total_saved })
        if (data.scanning) {
          setScanning(true)
          startPolling()
        }
      })
      .catch(() => {})
  }, [ready])

  useEffect(() => {
    if (cooldownRemaining <= 0) return
    const timer = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownRemaining])

  // Only fetch leads after ready + userId resolved — prevents showing other users' leads
  useEffect(() => {
    if (!ready) return
    fetchLeads(category, userId)
    fetchStats(userId)
  }, [category, userId, ready])

  useEffect(() => {
    if (category === 'Saved') fetchLeads('Saved', userId)
  }, [savedLeadIds])

  useEffect(() => {
    const channel = supabase.channel('leads-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
        fetchLeads(category, userId)
        fetchStats(userId)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [category, userId])

  const startPolling = () => {
    if (scanPollRef.current) clearInterval(scanPollRef.current)
    scanPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/ingest/status/`)
        const data = await res.json()
        setScanStats({ total_scanned: data.total_scanned, total_rejected: data.total_rejected, total_saved: data.total_saved })
        if (!data.scanning) {
          setScanning(false)
          clearInterval(scanPollRef.current!)
          scanPollRef.current = null
          // Refresh leads after scan finishes
          fetchLeads(category, userId)
          fetchStats(userId)
        }
      } catch {}
    }, 3000)
  }

  const fetchUser = async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/`)
      if (res.status === 404) {
        // User doesn't exist in this DB — stale localStorage, force re-login
        localStorage.clear()
        setUserId(null)
        setUserName('')
        setPreferencesSet(null)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      const displayName = data.name || data.username || ''
      setUserName(displayName)
      setUserPosition(data.profession || '')
      localStorage.setItem('cnvrted_user_name', displayName)
      if (data.username) localStorage.setItem('cnvrted_username', data.username)
      // TODO: re-enable 30-min cooldown before production deploy
      // if (data.last_scanned_at) {
      //   const elapsed = (Date.now() - new Date(data.last_scanned_at).getTime()) / 1000
      //   const remaining = Math.max(0, 1800 - elapsed)
      //   setCooldownRemaining(Math.floor(remaining))
      // }
      
      const hasPrefs = !!(data.service_offering?.trim())
      setPreferencesSet(hasPrefs)
      if (hasPrefs) {
        const suggestions = [data.service_offering, ...(data.target_industries || [])].filter(Boolean)
        setSuggestedDomains(suggestions.slice(0, 5))
      }
    } catch {}
  }

  const fetchSaved = async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/saves/`)
      if (!res.ok) return
      const data: string[] = await res.json()
      setSavedLeadIds(new Set(data))
    } catch {}
  }

  const fetchLeads = async (cat: string, uid: string | null) => {
    if (cat === 'Saved') {
      if (savedLeadIds.size === 0) { setLeads([]); return }
      const { data } = await supabase.from('leads').select('*').in('lead_id', [...savedLeadIds]).order('ingested_at', { ascending: false })
      setLeads(data || [])
      return
    }
    let query = supabase.from('leads').select('*').eq('qualified', true).order('ingested_at', { ascending: false }).limit(50)
    if (uid) query = query.eq('user_id', uid)
    if (cat !== 'All') query = query.eq('category', cat)
    const { data } = await query
    setLeads(data || [])
  }

  const fetchStats = async (uid: string | null) => {
    let query = supabase.from('leads').select('category').eq('qualified', true)
    if (uid) query = query.eq('user_id', uid)
    const { data } = await query
    const counts: Record<string, number> = {}
    data?.forEach(r => { counts[r.category] = (counts[r.category] || 0) + 1 })
    setStats(counts)
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim() || searchLoading) return
    setSearchLoading(true)
    try {
      const res = await fetch(`${API}/search/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_query: searchQuery.trim() })
      })
      const data = await res.json()
      setActiveSearch(data)
    } catch {}
    setSearchLoading(false)
  }

  const triggerIngest = async () => {
    if (cooldownRemaining > 0 || loading || scanning) return

    // Always re-resolve from current search box — never use stale activeSearch
    let search: ActiveSearch | null = null
    if (searchQuery.trim()) {
      setSearchLoading(true)
      try {
        const res = await fetch(`${API}/search/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw_query: searchQuery.trim() })
        })
        search = await res.json()
        setActiveSearch(search)
      } catch {}
      setSearchLoading(false)
    }

    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (userId) body.user_id = userId
      if (search) {
        body.keywords = search.keywords
        body.domain = search.domain
      }

      const res = await fetch(`${API}/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.status === 'Scan started in background') {
        setScanning(true)
        startPolling()
      }
      // TODO: re-enable 30-min cooldown before production deploy
    } catch {}
    setLoading(false)
  }

  const toggleSave = async (lead: Lead) => {
    if (!userId) return
    const isSaved = savedLeadIds.has(lead.lead_id)
    setSavedLeadIds(prev => {
      const s = new Set(prev)
      isSaved ? s.delete(lead.lead_id) : s.add(lead.lead_id)
      return s
    })
    try {
      await fetch(`${API}/users/${userId}/saves/${lead.lead_id}/`, {
        method: isSaved ? 'DELETE' : 'POST'
      })
    } catch {
      setSavedLeadIds(prev => {
        const s = new Set(prev)
        isSaved ? s.add(lead.lead_id) : s.delete(lead.lead_id)
        return s
      })
    }
  }

  const toggleReveal = async (leadId: string) => {
    // Call Apollo enrich endpoint then reveal
    try {
      const res = await fetch(`${API}/leads/${leadId}/enrich/`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        // Update lead in local state with enriched data
        setLeads(prev => prev.map(l => l.lead_id === leadId ? {
          ...l,
          contact_email: data.contact_email || l.contact_email,
          contact_phone: data.contact_phone || l.contact_phone,
        } : l))
      }
    } catch {}
    setRevealedContacts(prev => {
      const s = new Set(prev)
      s.has(leadId) ? s.delete(leadId) : s.add(leadId)
      return s
    })
  }

  if (!ready) return null
  if (!userId) {
    return <OnboardingScreen onComplete={(id, name) => { setUserId(id); setUserName(name); fetchSaved(id); setPreferencesSet(false) }} />
  }



  if (preferencesSet === null) return null
  if (!preferencesSet) {
    return (
      <PreferencesScreen
        userId={userId}
        onComplete={async (serviceOffering, industries) => {
          setPreferencesSet(true)
          const suggestions = [serviceOffering, ...industries].filter(Boolean)
          setSuggestedDomains(suggestions.slice(0, 5))
          // Pre-resolve service offering through LLM keyword generator
          try {
            const res = await fetch(`${API}/search/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw_query: serviceOffering })
            })
            const data = await res.json()
            setActiveSearch(data)
            setSearchQuery(serviceOffering)
          } catch {}
        }}
      />
    )
  }

  const uniqueCategories = ['All', ...Object.keys(stats).filter(k => k && k !== 'None'), 'Saved']

  return (
    <div className="h-screen flex overflow-hidden grid-bg">
      {profileOpen && (
        <ProfileModal
          userName={userName}
          userPosition={userPosition}
          savedLeadIds={savedLeadIds}
          onClose={() => setProfileOpen(false)}
          onLogout={() => {
            localStorage.clear()
            setUserId(null)
            setUserName('')
            setProfileOpen(false)
            setPreferencesSet(null)
            setLeads([])
          }}
        />
      )}
      {previewLead && (
        <PostPreviewModal lead={previewLead} onClose={() => setPreviewLead(null)} />
      )}

      {/* Sidebar */}
      <aside className="w-52 border-r border-black/10 bg-white/80 backdrop-blur flex flex-col h-screen shrink-0">
        <div className="px-5 py-5 border-b border-black/10">
          <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-black">cnvrted</span>
        </div>

        <div className="px-4 pt-4">
          <input
            type="text"
            value={searchQuery}
            onChange={e => { setSearchQuery(e.target.value); setActiveSearch(null) }}
            placeholder="e.g. filmmaker"
            className="font-mono-custom w-full border border-black/20 px-2 py-1.5 text-xs outline-none focus:border-black transition placeholder:text-gray-300"
          />
          {activeSearch && (
            <div className="mt-2.5 px-0.5">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">Domain</p>
              <p className="font-canela text-sm text-black mt-0.5">{activeSearch.domain}</p>
            </div>
          )}
          {!activeSearch && suggestedDomains.length > 0 && (
            <div className="mt-3 px-0.5">
              <p className="font-mono-custom text-xs text-gray-300 uppercase tracking-widest mb-2">Suggested</p>
              <div className="flex flex-col gap-1">
                {suggestedDomains.map(d => (
                  <button
                    key={d}
                    onClick={() => setSearchQuery(d)}
                    className={`font-mono-custom text-xs text-left px-2 py-1.5 border transition truncate
                      ${searchQuery === d ? 'border-black bg-black text-white' : 'border-black/15 text-gray-500 hover:border-black/40 hover:text-black'}`}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 pt-3">
          <button
            onClick={triggerIngest}
            disabled={loading || scanning || cooldownRemaining > 0}
            className="font-mono-custom w-full border border-black text-black text-xs px-3 py-2 uppercase tracking-widest hover:bg-black hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {scanning ? (
              <span className="flex items-center justify-center gap-1.5">
                <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="inline-block w-1.5 h-1.5 bg-current rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                <span>Scanning...</span>
              </span>
            ) : loading ? 'Starting...' : cooldownRemaining > 0 ? `⏱ ${formatCountdown(cooldownRemaining)}` : '⚡ Scan'}
          </button>
          {cooldownRemaining > 0 && (
            <p className="font-mono-custom text-xs text-gray-300 text-center mt-1.5">next scan in {formatCountdown(cooldownRemaining)}</p>
          )}
        </div>

        <nav className="flex flex-col gap-0.5 px-3 pt-5 flex-1 overflow-y-auto">
          <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest px-2 mb-2">Feeds</p>
          {uniqueCategories.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`font-mono-custom w-full text-left px-2 py-2 text-xs flex justify-between items-center transition uppercase tracking-wide
                ${category === cat ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <span>{cat === 'Saved' ? '♡ Saved' : cat}</span>
              {cat !== 'All' && cat !== 'Saved' && (
                <span className={`text-xs px-1.5 py-0.5 ${category === cat ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {stats[cat] || 0}
                </span>
              )}
              {cat === 'Saved' && savedLeadIds.size > 0 && (
                <span className={`text-xs px-1.5 py-0.5 ${category === cat ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {savedLeadIds.size}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-5 pb-5" />
      </aside>

      {/* Main */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="flex items-center justify-between px-8 py-4 border-b border-black/10 bg-white/70 backdrop-blur shrink-0">
          <h1 className="font-canela text-2xl font-light text-black tracking-tight">
            {category === 'All' ? 'All Intent Signals' : category === 'Saved' ? 'Saved Leads' : category}
          </h1>
          <div className="flex items-center gap-4">
            <span className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">{leads.length} leads</span>
            <button
              onClick={() => setProfileOpen(true)}
              className="flex items-center gap-2 hover:opacity-70 transition"
            >
              <div className="w-7 h-7 bg-black flex items-center justify-center font-canela text-white text-xs">
                {userName[0]?.toUpperCase() || '?'}
              </div>
              <span className="font-mono-custom text-xs text-gray-600 uppercase tracking-widest">{userName}</span>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {leads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300">
              <p className="font-canela text-5xl mb-3 font-light">{category === 'Saved' ? '♡' : '📡'}</p>
              <p className="font-mono-custom text-xs uppercase tracking-widest">
                {category === 'Saved' ? 'No saved leads yet' : 'Search for a domain, then hit scan'}
              </p>
            </div>
          )}

          {leads.length > 0 && leads.every(l => isOlderThan24h(l.posted_at)) && (
            <div className="max-w-4xl mb-4 px-4 py-2.5 border border-amber-200 bg-amber-50 font-mono-custom text-xs text-amber-600 uppercase tracking-widest">
              No recent activity — showing older results
            </div>
          )}

          <div className="flex flex-col gap-4 max-w-4xl">
            {leads.map(lead => {
              const hasEmail = !!lead.contact_email
              const hasPhone = !!lead.contact_phone
              const isRevealed = revealedContacts.has(lead.lead_id)
              return (
                <div key={lead.id} className="bg-white border border-black/10 p-6 hover:border-black/30 hover:shadow-md transition">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 border border-black/20 flex items-center justify-center font-canela text-sm font-medium shrink-0">
                        {lead.author?.[0]?.toUpperCase() || '?'}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          {/* Platform logo → links to author profile */}
                          {lead.contact_linkedin && (
                            <a href={lead.contact_linkedin} target="_blank" rel="noopener noreferrer" className="shrink-0 hover:opacity-70 transition">
                              {lead.platform === 'reddit' ? (
                                <svg width="16" height="16" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg">
                                  <circle cx="10" cy="10" r="10" fill="#FF4500"/>
                                  <path d="M16.67 10a1.46 1.46 0 0 0-2.47-1 7.12 7.12 0 0 0-3.85-1.23l.65-3.08 2.13.45a1 1 0 1 0 .14-.55l-2.38-.5a.27.27 0 0 0-.32.2l-.73 3.44a7.14 7.14 0 0 0-3.89 1.23 1.46 1.46 0 1 0-1.61 2.39 2.9 2.9 0 0 0 0 .44c0 2.24 2.61 4.06 5.83 4.06s5.83-1.82 5.83-4.06a2.9 2.9 0 0 0 0-.44 1.46 1.46 0 0 0 .67-1.35zM7.27 11a1 1 0 1 1 1 1 1 1 0 0 1-1-1zm5.59 2.71a3.58 3.58 0 0 1-2.86.86 3.58 3.58 0 0 1-2.86-.86.27.27 0 0 1 .38-.38 3.06 3.06 0 0 0 2.48.68 3.06 3.06 0 0 0 2.48-.68.27.27 0 0 1 .38.38zm-.13-1.71a1 1 0 1 1 1-1 1 1 0 0 1-1 1z" fill="white"/>
                                </svg>
                              ) : lead.platform === 'twitter' ? (
                                <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  <rect width="24" height="24" rx="4" fill="#000"/>
                                  <path d="M17.5 4h2.5l-5.5 6.3L21 20h-5l-3.6-4.7L8 20H5.5l5.8-6.7L4 4h5.1l3.3 4.3L17.5 4zm-.9 14.4h1.4L7.4 5.4H5.9l10.7 13z" fill="white"/>
                                </svg>
                              ) : (
                                <svg width="16" height="16" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                  <rect width="24" height="24" rx="4" fill="#0A66C2"/>
                                  <path d="M7.5 9.5H5v9h2.5v-9zm-1.25-4a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM19 13.5c0-2.5-1.5-4-3.5-4a3.5 3.5 0 0 0-2.5 1V9.5H10.5v9H13v-5c0-1 .5-2 1.75-2S16.5 13 16.5 14v4.5H19V13.5z" fill="white"/>
                                </svg>
                              )}
                            </a>
                          )}
                          <p className="font-canela text-lg font-medium text-black leading-tight">{lead.author}</p>
                          {isOlderThan24h(lead.posted_at) && (
                            <span className="font-mono-custom text-xs text-amber-500 border border-amber-200 px-1.5 py-0.5 leading-none">Older Post</span>
                          )}
                        </div>
                        {lead.profession && <p className="font-mono-custom text-xs text-gray-500 mt-0.5">{lead.profession}</p>}
                        {lead.domain && <p className="font-mono-custom text-xs text-gray-400">{lead.domain}</p>}
                        {lead.location && (
                          <p className="font-mono-custom text-xs text-gray-400 mt-0.5">📍 {lead.location}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={`font-mono-custom text-xs font-bold ${timelineColor(lead.timeline)}`}>{lead.timeline}</span>
                      <span className={`font-mono-custom text-xs px-2 py-1 font-bold ${scoreColor(lead.intent_score)}`}>
                        {lead.intent_score}
                      </span>
                      <button
                        onClick={() => toggleSave(lead)}
                        className={`text-lg leading-none transition hover:scale-110 ${savedLeadIds.has(lead.lead_id) ? 'text-black' : 'text-gray-300 hover:text-gray-500'}`}
                        title={savedLeadIds.has(lead.lead_id) ? 'Unsave' : 'Save'}
                      >
                        {savedLeadIds.has(lead.lead_id) ? '♥' : '♡'}
                      </button>
                    </div>
                  </div>

                  {lead.exact_need && (
                    <div className="border-l-2 border-black pl-3 mb-4">
                      <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Looking for</p>
                      <p className="font-canela text-base text-black">{lead.exact_need}</p>
                    </div>
                  )}

                  <p className="text-gray-500 text-sm leading-relaxed line-clamp-3 mb-4">{lead.post_text}</p>

                  <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-gray-100">
                    {/* Email contact — Apollo enrichment for LinkedIn only */}
                    {hasEmail ? (
                      isRevealed ? (
                        <span className="font-mono-custom text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1">
                          ✉ {lead.contact_email}
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleReveal(lead.lead_id)}
                          className="font-mono-custom text-xs border border-green-400 text-green-600 bg-green-50 px-2.5 py-1 hover:bg-green-100 transition"
                        >
                          ✉ Reveal Email
                        </button>
                      )
                    ) : lead.platform === 'linkedin' ? (
                      <button
                        onClick={() => toggleReveal(lead.lead_id)}
                        className="font-mono-custom text-xs border border-green-400 text-green-600 bg-green-50 px-2.5 py-1 hover:bg-green-100 transition"
                        title="Fetch via Apollo"
                      >
                        ✉ Reveal Email
                      </button>
                    ) : null}

                    {/* Phone contact — Apollo enrichment for LinkedIn only */}
                    {hasPhone ? (
                      isRevealed ? (
                        <span className="font-mono-custom text-xs text-green-700 bg-green-50 border border-green-200 px-2.5 py-1">
                          📞 {lead.contact_phone}
                        </span>
                      ) : (
                        <button
                          onClick={() => toggleReveal(lead.lead_id)}
                          className="font-mono-custom text-xs border border-green-400 text-green-600 bg-green-50 px-2.5 py-1 hover:bg-green-100 transition"
                        >
                          📞 Reveal Phone
                        </button>
                      )
                    ) : lead.platform === 'linkedin' ? (
                      <button
                        onClick={() => toggleReveal(lead.lead_id)}
                        className="font-mono-custom text-xs border border-green-400 text-green-600 bg-green-50 px-2.5 py-1 hover:bg-green-100 transition"
                        title="Fetch via Apollo"
                      >
                        📞 Reveal Phone
                      </button>
                    ) : null}

                    {/* Token usage badge — internal only, remove before public launch */}
                    {lead.tokens_used ? (
                      <span className="font-mono-custom text-xs text-gray-300 border border-gray-100 px-1.5 py-0.5" title="Tokens used for scoring">
                        {lead.tokens_used}t
                      </span>
                    ) : null}
                    <span className="font-mono-custom text-xs text-gray-300 ml-auto">{formatDate(lead.posted_at || lead.ingested_at)}</span>
                    {lead.source_url && (
                      <button onClick={() => setPreviewLead(lead)} className="font-mono-custom text-xs text-gray-400 hover:text-black transition">
                        View post ↗
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </main>

      {/* Right panel — scan metrics */}
      <aside className="w-56 border-l border-black/10 bg-white/80 backdrop-blur flex flex-col h-screen shrink-0">
        <div className="px-5 py-5 border-b border-black/10">
          <p className="font-mono-custom text-xs font-bold tracking-widest uppercase text-black">Scan Metrics</p>
        </div>

        <div className="px-5 py-6 flex flex-col gap-6">
          {/* Scanning indicator */}
          {scanning && (
            <div className="flex items-center gap-2 py-2 px-3 border border-amber-200 bg-amber-50">
              <span className="inline-block w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse shrink-0" />
              <p className="font-mono-custom text-xs text-amber-600 uppercase tracking-widest">Scanning...</p>
            </div>
          )}

          {/* Posts scanned */}
          <div>
            <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Posts Scanned</p>
            <p className="font-canela text-4xl font-light text-black leading-none">
              {scanStats.total_scanned}
            </p>
          </div>

          {/* Rejected */}
          <div>
            <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Rejected</p>
            <p className="font-canela text-4xl font-light text-red-400 leading-none">
              {scanStats.total_rejected}
            </p>
          </div>

          {/* Accepted */}
          <div>
            <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Accepted</p>
            <p className="font-canela text-4xl font-light text-green-600 leading-none">
              {scanStats.total_saved}
            </p>
          </div>

          {scanStats.total_scanned === 0 && !scanning && (
            <p className="font-mono-custom text-xs text-gray-300 uppercase tracking-widest leading-relaxed">
              Hit scan to see metrics here
            </p>
          )}
        </div>
      </aside>
    </div>
  )
}
