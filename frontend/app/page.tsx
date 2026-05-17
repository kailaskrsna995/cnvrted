'use client'

import { useEffect, useState } from 'react'
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
  urgency: string
  source_url: string
  contact_email: string
  contact_phone: string
  contact_linkedin: string
  ingested_at: string
}

type ActiveSearch = { domain: string; keywords: string[] }

function scoreColor(score: number) {
  if (score >= 80) return 'bg-black text-white'
  if (score >= 60) return 'bg-gray-700 text-white'
  return 'bg-gray-200 text-gray-700'
}

function urgencyColor(urgency: string) {
  if (urgency === 'High') return 'text-red-500'
  if (urgency === 'Medium') return 'text-amber-500'
  return 'text-gray-400'
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function OnboardingScreen({ onComplete }: { onComplete: (userId: string) => void }) {
  const [name, setName] = useState('')
  const [position, setPosition] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || loading) return
    setLoading(true)
    try {
      const res = await fetch(`${API}/users/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), position: position.trim() })
      })
      const user = await res.json()
      localStorage.setItem('cnvrted_user_id', user.id)
      onComplete(user.id)
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="h-screen flex items-center justify-center grid-bg">
      <div className="bg-white border border-black/10 p-10 w-full max-w-sm">
        <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-2">cnvrted</p>
        <h1 className="font-canela text-3xl font-light text-black mb-8">Who are you?</h1>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-1.5">Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Your name"
              className="font-canela text-base w-full border border-black/20 px-3 py-2 outline-none focus:border-black transition"
              autoFocus
            />
          </div>
          <div>
            <label className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest block mb-1.5">
              Position <span className="text-gray-300 normal-case">(optional)</span>
            </label>
            <input
              type="text"
              value={position}
              onChange={e => setPosition(e.target.value)}
              placeholder="e.g. Founder, Sales Lead"
              className="font-canela text-base w-full border border-black/20 px-3 py-2 outline-none focus:border-black transition"
            />
          </div>
          <button
            type="submit"
            disabled={!name.trim() || loading}
            className="font-mono-custom mt-2 w-full border border-black bg-black text-white text-xs px-3 py-2.5 uppercase tracking-widest hover:bg-gray-900 transition disabled:opacity-40"
          >
            {loading ? 'Setting up...' : 'Enter →'}
          </button>
        </form>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [category, setCategory] = useState('All')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeSearch, setActiveSearch] = useState<ActiveSearch | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)

  useEffect(() => {
    const id = localStorage.getItem('cnvrted_user_id')
    if (id) {
      setUserId(id)
      fetchUser(id)
      fetchSaved(id)
    }
    setReady(true)
  }, [])

  // Countdown timer
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

  useEffect(() => {
    fetchLeads(category)
    fetchStats()
  }, [category])

  useEffect(() => {
    if (category === 'Saved') fetchLeads('Saved')
  }, [savedLeadIds])

  // Realtime new leads
  useEffect(() => {
    const channel = supabase.channel('leads-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
        fetchLeads(category)
        fetchStats()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [category])

  const fetchUser = async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/`)
      if (!res.ok) return
      const data = await res.json()
      if (data.last_scanned_at) {
        const elapsed = (Date.now() - new Date(data.last_scanned_at).getTime()) / 1000
        const remaining = Math.max(0, 1800 - elapsed)
        setCooldownRemaining(Math.floor(remaining))
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

  const fetchLeads = async (cat: string) => {
    if (cat === 'Saved') {
      if (savedLeadIds.size === 0) { setLeads([]); return }
      const { data } = await supabase.from('leads').select('*').in('lead_id', [...savedLeadIds]).order('ingested_at', { ascending: false })
      setLeads(data || [])
      return
    }
    let query = supabase.from('leads').select('*').eq('qualified', true).order('ingested_at', { ascending: false }).limit(50)
    if (cat !== 'All') query = query.eq('category', cat)
    const { data } = await query
    setLeads(data || [])
  }

  const fetchStats = async () => {
    const { data } = await supabase.from('leads').select('category').eq('qualified', true)
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
    if (cooldownRemaining > 0 || loading) return
    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (userId) body.user_id = userId
      if (activeSearch) {
        body.keywords = activeSearch.keywords
        body.domain = activeSearch.domain
      }
      const res = await fetch(`${API}/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.status === 'cooldown') {
        setCooldownRemaining(data.remaining_seconds)
      }
    } catch {}
    setLoading(false)
  }

  const toggleSave = async (lead: Lead) => {
    if (!userId) return
    const isSaved = savedLeadIds.has(lead.lead_id)
    // Optimistic update
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
      // Roll back on error
      setSavedLeadIds(prev => {
        const s = new Set(prev)
        isSaved ? s.add(lead.lead_id) : s.delete(lead.lead_id)
        return s
      })
    }
  }

  if (!ready) return null
  if (!userId) {
    return <OnboardingScreen onComplete={(id) => { setUserId(id); fetchSaved(id) }} />
  }

  const sidebarCategories = ['All', ...Object.keys(stats).filter(k => k && k !== 'None'), 'Saved']
  const uniqueCategories = [...new Set(sidebarCategories)]

  return (
    <div className="h-screen flex overflow-hidden grid-bg">

      {/* Sidebar */}
      <aside className="w-52 border-r border-black/10 bg-white/80 backdrop-blur flex flex-col h-screen shrink-0">
        <div className="px-5 py-5 border-b border-black/10">
          <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-black">cnvrted</span>
        </div>

        {/* Search */}
        <div className="px-4 pt-4">
          <form onSubmit={handleSearch}>
            <div className="flex gap-1">
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="e.g. filmmaker"
                className="font-mono-custom flex-1 min-w-0 border border-black/20 px-2 py-1.5 text-xs outline-none focus:border-black transition placeholder:text-gray-300"
              />
              <button
                type="submit"
                disabled={searchLoading || !searchQuery.trim()}
                className="font-mono-custom border border-black/20 px-2 py-1.5 text-xs hover:bg-black hover:text-white hover:border-black transition disabled:opacity-40"
              >
                {searchLoading ? '…' : '→'}
              </button>
            </div>
          </form>
          {activeSearch && (
            <div className="mt-2.5 px-0.5">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">Domain</p>
              <p className="font-canela text-sm text-black mt-0.5">{activeSearch.domain}</p>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {activeSearch.keywords.slice(0, 3).map(kw => (
                  <span key={kw} className="font-mono-custom text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 leading-tight">{kw}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scan button */}
        <div className="px-4 pt-3">
          <button
            onClick={triggerIngest}
            disabled={loading || cooldownRemaining > 0}
            className="font-mono-custom w-full border border-black text-black text-xs px-3 py-2 uppercase tracking-widest hover:bg-black hover:text-white transition disabled:opacity-40"
          >
            {loading ? 'Scanning...' : cooldownRemaining > 0 ? `⏱ ${formatCountdown(cooldownRemaining)}` : '⚡ Scan'}
          </button>
          {cooldownRemaining > 0 && (
            <p className="font-mono-custom text-xs text-gray-300 text-center mt-1.5">
              next scan in {formatCountdown(cooldownRemaining)}
            </p>
          )}
        </div>

        {/* Feeds */}
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

      {/* Main feed */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="flex items-center justify-between px-8 py-4 border-b border-black/10 bg-white/70 backdrop-blur shrink-0">
          <h1 className="font-canela text-2xl font-light text-black tracking-tight">
            {category === 'All' ? 'All Intent Signals' : category === 'Saved' ? 'Saved Leads' : category}
          </h1>
          <span className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">{leads.length} leads</span>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-6">
          {leads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300">
              <p className="font-canela text-5xl mb-3 font-light">{category === 'Saved' ? '♡' : '📡'}</p>
              <p className="font-mono-custom text-xs uppercase tracking-widest">
                {category === 'Saved' ? 'No saved leads yet' : 'No signals yet — run a scan'}
              </p>
            </div>
          )}

          <div className="flex flex-col gap-4 max-w-4xl">
            {leads.map(lead => (
              <div key={lead.id} className="bg-white border border-black/10 p-6 hover:border-black/30 hover:shadow-md transition">

                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 border border-black/20 flex items-center justify-center font-canela text-sm font-medium shrink-0">
                      {lead.author?.[0]?.toUpperCase() || '?'}
                    </div>
                    <div>
                      <p className="font-canela text-lg font-medium text-black leading-tight">{lead.author}</p>
                      {lead.profession && <p className="font-mono-custom text-xs text-gray-500 mt-0.5">{lead.profession}</p>}
                      {lead.domain && <p className="font-mono-custom text-xs text-gray-400">{lead.domain}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`font-mono-custom text-xs font-bold ${urgencyColor(lead.urgency)}`}>{lead.urgency}</span>
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

                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-gray-100">
                  <span className="font-mono-custom text-xs text-gray-400">✉ {lead.contact_email || 'Unavailable'}</span>
                  <span className="font-mono-custom text-xs text-gray-400">📞 {lead.contact_phone || 'Unavailable'}</span>
                  {lead.contact_linkedin
                    ? <a href={lead.contact_linkedin} target="_blank" rel="noopener noreferrer" className="font-mono-custom text-xs text-black underline underline-offset-2">LinkedIn ↗</a>
                    : <span className="font-mono-custom text-xs text-gray-300">No LinkedIn</span>
                  }
                  <span className="font-mono-custom text-xs text-gray-300 ml-auto">{formatDate(lead.ingested_at)}</span>
                  {lead.source_url && (
                    <a href={lead.source_url} target="_blank" rel="noopener noreferrer" className="font-mono-custom text-xs text-gray-400 hover:text-black">
                      View post ↗
                    </a>
                  )}
                </div>

              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  )
}
