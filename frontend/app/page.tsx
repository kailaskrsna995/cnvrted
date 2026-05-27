'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { Lead, ScanStats } from '../lib/types'
import { Sidebar } from '../components/Sidebar'
import { ChatInterface, ChatMsg } from '../components/ChatInterface'
import { LeadFeed } from '../components/LeadFeed'
import { PostPreviewModal } from '../components/PostPreviewModal'
import { OnboardingScreen } from '../components/OnboardingScreen'
import { OnboardingQuestionnaire } from '../components/OnboardingQuestionnaire'

const API = process.env.NEXT_PUBLIC_API_URL

function extractFirstName(nameOrEmail: string): string {
  if (!nameOrEmail) return ''
  if (nameOrEmail.includes('@')) {
    const local = nameOrEmail.split('@')[0]
    const first = local.split(/[._]/)[0]
    return first.charAt(0).toUpperCase() + first.slice(1)
  }
  return nameOrEmail.split(' ')[0]
}

function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// ── Minimal dark profile modal ────────────────────────────────────────────────
function ProfileModal({ userName, onClose, onLogout, savedLeadIds }: {
  userName: string
  onClose: () => void
  onLogout: () => void
  savedLeadIds: Set<string>
}) {
  const username = typeof window !== 'undefined' ? localStorage.getItem('cnvrted_username') || '' : ''
  return (
    <div className="fixed inset-0 z-50 flex" onClick={onClose}>
      <div className="flex-1" />
      <div
        className="w-80 bg-[#07070a] border-l border-white/5 flex flex-col h-full"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-6 py-5 border-b border-white/5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-semibold">
              {userName[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-[15px] font-medium text-white leading-tight">{userName}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{username}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition text-lg">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 pb-5 border-b border-white/5">
            <div className="flex justify-between items-center mb-2">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest">Credits</p>
              <p className="text-[11px] text-gray-500">0 / 100</p>
            </div>
            <div className="w-full h-1 bg-gray-800 rounded-full">
              <div className="h-1 bg-indigo-500 rounded-full" style={{ width: '0%' }} />
            </div>
            <p className="text-[11px] text-gray-600 mt-1.5">Payments coming soon</p>
          </div>

          <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-3">
            Saved — {savedLeadIds.size}
          </p>
          {savedLeadIds.size === 0 && (
            <p className="text-[12px] text-gray-600">No saved leads yet.</p>
          )}
        </div>

        <div className="px-6 py-5 border-t border-white/5">
          <button
            onClick={onLogout}
            className="text-[12px] text-red-400 hover:text-red-300 transition"
          >
            Log out
          </button>
        </div>
      </div>
    </div>
  )
}

export default function Dashboard() {
  // ── Auth & user ───────────────────────────────────────────────────────────
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [userPosition, setUserPosition] = useState('')
  const [ready, setReady] = useState(false)
  const [preferencesSet, setPreferencesSet] = useState<boolean | null>(null)
  const [suggestedDomains, setSuggestedDomains] = useState<string[]>([])

  // ── Leads & stats ─────────────────────────────────────────────────────────
  const [leads, setLeads] = useState<Lead[]>([])
  const [category, setCategory] = useState('All')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const [allLeadStats, setAllLeadStats] = useState({ total: 0, qualified: 0, urgent: 0, linkedin: 0, twitter: 0, reddit: 0, indiehackers: 0 })
  const [scanStats, setScanStats] = useState<ScanStats>({ total_scanned: 0, total_rejected: 0, total_saved: 0 })

  // ── Scan state ────────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [lastScanParams, setLastScanParams] = useState<{ domain: string; keywords: string[] } | null>(null)
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Chat ──────────────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const chatEndRef = useRef<HTMLDivElement>(null)

  // ── UI state ──────────────────────────────────────────────────────────────
  const [profileOpen, setProfileOpen] = useState(false)
  const [previewLead, setPreviewLead] = useState<Lead | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [mobileFeedOpen, setMobileFeedOpen] = useState(false)
  const [feedWidth, setFeedWidth] = useState(384)

  const firstName = extractFirstName(userName)

  // ── Resize handler ────────────────────────────────────────────────────────
  const handleResizeStart = () => {
    let lastX = -1
    const onMove = (e: MouseEvent) => {
      if (lastX === -1) { lastX = e.clientX; return }
      const delta = lastX - e.clientX
      lastX = e.clientX
      setFeedWidth(w => Math.min(700, Math.max(280, w + delta)))
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
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

  useEffect(() => {
    if (!ready) return
    fetch(`${API}/ingest/status/`)
      .then(r => r.json())
      .then(data => {
        setScanStats({ total_scanned: data.total_scanned, total_rejected: data.total_rejected, total_saved: data.total_saved })
        if (data.scanning) { setScanning(true); startPolling() }
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

  // ── Data fetchers ─────────────────────────────────────────────────────────
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
        localStorage.clear(); setUserId(null); setUserName(''); setPreferencesSet(null); return
      }
      if (!res.ok) return
      const data = await res.json()
      const displayName = data.name || data.username || ''
      setUserName(displayName)
      setUserPosition(data.profession || '')
      localStorage.setItem('cnvrted_user_name', displayName)
      if (data.username) localStorage.setItem('cnvrted_username', data.username)
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
    let query = supabase.from('leads').select('*').order('ingested_at', { ascending: false }).limit(200)
    if (uid) query = query.eq('user_id', uid)
    if (cat !== 'All') query = query.eq('category', cat)
    const { data } = await query
    setLeads(data || [])
  }

  const fetchStats = async (uid: string | null) => {
    let query = supabase.from('leads').select('category, timeline, platform, intent_score, qualified')
    if (uid) query = query.eq('user_id', uid)
    const { data } = await query
    const counts: Record<string, number> = {}
    let qualified = 0, urgent = 0, linkedin = 0, twitter = 0, reddit = 0, indiehackers = 0
    data?.forEach(r => {
      counts[r.category] = (counts[r.category] || 0) + 1
      if (r.timeline === 'Urgent') urgent++
      if (r.platform === 'linkedin') linkedin++
      if (r.platform === 'twitter') twitter++
      if (r.platform === 'reddit') reddit++
      if (r.platform === 'indiehackers') indiehackers++
      if ((r.intent_score || 0) >= 60) qualified++
    })
    setStats(counts)
    setAllLeadStats({ total: data?.length || 0, qualified, urgent, linkedin, twitter, reddit, indiehackers })
  }

  // ── Actions ───────────────────────────────────────────────────────────────
  const sendChat = async () => {
    if (!searchQuery.trim() || chatLoading) return
    const userMsg = searchQuery.trim()
    setSearchQuery('')
    const prevHistory = [...chatMessages]
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setChatLoading(true)
    try {
      const res = await fetch(`${API}/chat/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: userId,
          message: userMsg,
          history: prevHistory.map(m => ({ role: m.role, text: m.text }))
        })
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const aiMsg: ChatMsg = {
        role: 'ai',
        text: data.message || "What does your agency do? I'll find the right buyers for you.",
        ...(data.type === 'ready' ? { scanParams: { domain: data.domain, keywords: data.keywords } } : {})
      }
      setChatMessages(prev => [...prev, aiMsg])
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch {
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong. Try again.' }])
    } finally {
      setChatLoading(false)
    }
  }

  const triggerIngest = async (params?: { keywords: string[]; domain: string }) => {
    if (cooldownRemaining > 0 || loading || scanning) return
    if (params) setLastScanParams(params)
    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (userId) body.user_id = userId
      if (params) { body.keywords = params.keywords; body.domain = params.domain }
      const res = await fetch(`${API}/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.status === 'Scan started in background') { setScanning(true); startPolling() }
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
      await fetch(`${API}/users/${userId}/saves/${lead.lead_id}/`, { method: isSaved ? 'DELETE' : 'POST' })
    } catch {
      setSavedLeadIds(prev => {
        const s = new Set(prev)
        isSaved ? s.add(lead.lead_id) : s.delete(lead.lead_id)
        return s
      })
    }
  }

  // ── Auth gates ────────────────────────────────────────────────────────────
  if (!ready) return null

  if (!userId) {
    return (
      <OnboardingScreen
        onComplete={(id, name, status) => {
          setUserId(id)
          setUserName(name)
          fetchSaved(id)
          setPreferencesSet(status !== 'pending' ? true : false)
        }}
      />
    )
  }

  if (preferencesSet === null) return null

  if (!preferencesSet) {
    return (
      <OnboardingQuestionnaire
        userId={userId}
        onComplete={async (serviceOffering, industries) => {
          setPreferencesSet(true)
          const suggestions = [serviceOffering, ...industries].filter(Boolean)
          setSuggestedDomains(suggestions.slice(0, 5))
          try {
            const res = await fetch(`${API}/search/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw_query: serviceOffering })
            })
            const data = await res.json()
            setSearchQuery(serviceOffering)
          } catch {}
        }}
      />
    )
  }

  // ── Main dashboard ────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex bg-[#030308] overflow-hidden relative">

      {/* Ambient glows */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="absolute top-0 right-1/4 w-[600px] h-[400px] bg-indigo-600/5 rounded-full blur-[120px]" />
        <div className="absolute bottom-0 left-1/4 w-[500px] h-[400px] bg-violet-600/5 rounded-full blur-[120px]" />
      </div>

      {/* ── Modals ── */}
      {profileOpen && (
        <ProfileModal
          userName={userName}
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

      {/* ── Sidebar ── */}
      <Sidebar
        mobileNavOpen={mobileNavOpen}
        setMobileNavOpen={setMobileNavOpen}
        category={category}
        setCategory={setCategory}
        firstName={firstName}
        setProfileOpen={setProfileOpen}
        stats={stats}
        savedLeadIds={savedLeadIds}
      />

      {/* ── Main ── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden relative z-10">

        {/* Header bar */}
        <div className="shrink-0 px-6 py-3.5 border-b border-white/5 flex items-center justify-between bg-[#030308]/80 backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileNavOpen(true)} className="lg:hidden w-8 h-8 flex items-center justify-center text-gray-500 hover:text-white transition">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"/></svg>
            </button>
            <h1 className="text-[15px] font-semibold text-white tracking-tight">
              {category === 'All' ? 'Overview' : category === 'Saved' ? 'Saved Leads' : category}
            </h1>
            {scanning && (
              <div className="flex items-center gap-1.5 ml-2">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-pulse" />
                <span className="text-[11px] text-indigo-400 tracking-wide">Scanning…</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileFeedOpen(true)}
              className="lg:hidden relative w-8 h-8 flex items-center justify-center text-gray-500 hover:text-white transition"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
              {leads.length > 0 && <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-indigo-500 rounded-full" />}
            </button>
            <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2 hover:opacity-80 transition">
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">
                {firstName[0]?.toUpperCase() || 'U'}
              </div>
              <div className="hidden md:block text-left">
                <p className="text-[12px] font-medium text-white leading-tight">{firstName}</p>
                <p className="text-[10px] text-gray-500 leading-tight">Early Access</p>
              </div>
            </button>
          </div>
        </div>

        {/* Scrollable content: stats + charts + chat */}
        <div className="flex-1 flex flex-col overflow-hidden">

          {/* Stats + charts (always visible, shrink-0 so they stay at top) */}
          <div className="shrink-0 px-6 pt-5 pb-4 border-b border-white/5">
            {/* 4 stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {[
                { label: 'Total Leads', value: allLeadStats.total, sub: 'all time' },
                { label: 'Qualified', value: allLeadStats.qualified, sub: 'score ≥ 60' },
                { label: 'Urgent', value: allLeadStats.urgent, sub: 'need reply now' },
                { label: 'Posts Scanned', value: scanStats.total_scanned, sub: `${scanStats.total_rejected} rejected` },
              ].map(card => (
                <div key={card.label} className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 hover:border-white/10 transition">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1.5">{card.label}</p>
                  <p className="text-2xl font-semibold text-white leading-none mb-1">{card.value}</p>
                  <p className="text-[9px] text-gray-600">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Leads by source + top industries */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Leads by source */}
              <div className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5">
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-3">Leads by Source</p>
                {allLeadStats.total > 0 ? (
                  <div className="flex flex-col gap-2">
                    {[
                      { label: 'LinkedIn', count: allLeadStats.linkedin, color: 'bg-blue-500' },
                      { label: 'X / Twitter', count: allLeadStats.twitter, color: 'bg-gray-400' },
                      { label: 'Reddit', count: allLeadStats.reddit, color: 'bg-orange-500' },
                    ].filter(s => s.count > 0).map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400 w-20 shrink-0">{s.label}</span>
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full ${s.color} rounded-full`} style={{ width: `${Math.round((s.count / allLeadStats.total) * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-500 w-8 text-right tabular-nums">
                          {Math.round((s.count / allLeadStats.total) * 100)}%
                        </span>
                      </div>
                    ))}
                    {allLeadStats.linkedin === 0 && allLeadStats.twitter === 0 && allLeadStats.reddit === 0 && (
                      <p className="text-[11px] text-gray-600">No source data yet</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600">No data yet — run a scan first</p>
                )}
              </div>

              {/* Top industries */}
              <div className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5">
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-3">Top Industries</p>
                {Object.keys(stats).filter(k => k && k !== 'None').length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {Object.entries(stats)
                      .filter(([k]) => k && k !== 'None')
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 4)
                      .map(([cat, count]) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 flex-1 truncate">{cat}</span>
                          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round((count / allLeadStats.total) * 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-500 w-8 text-right tabular-nums shrink-0">
                            {Math.round((count / allLeadStats.total) * 100)}%
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600">No data yet — run a scan first</p>
                )}
              </div>
            </div>

            {/* Post-scan actions */}
            {!scanning && lastScanParams && (
              <div className="flex items-center gap-2 mt-3">
                {scanStats.total_scanned > 0 && (
                  <span className="text-[10px] text-emerald-500">
                    ✓ {scanStats.total_saved} leads from {scanStats.total_scanned} posts
                  </span>
                )}
                <button
                  onClick={() => triggerIngest(lastScanParams!)}
                  disabled={scanning || loading || cooldownRemaining > 0}
                  className="text-[11px] text-indigo-400 hover:text-indigo-300 transition disabled:opacity-40 ml-auto"
                >
                  {cooldownRemaining > 0 ? `⏱ ${formatCountdown(cooldownRemaining)}` : 'Rerun ↺'}
                </button>
                <button
                  onClick={() => { setLastScanParams(null); setChatMessages([]); setScanStats({ total_scanned: 0, total_rejected: 0, total_saved: 0 }) }}
                  className="text-[11px] text-gray-500 hover:text-gray-300 transition"
                >
                  New search
                </button>
              </div>
            )}
          </div>

          {/* Chat area (compact — no big header, messages + input) */}
          <ChatInterface
            chatMessages={chatMessages}
            chatLoading={chatLoading}
            chatEndRef={chatEndRef}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            sendChat={sendChat}
            triggerIngest={triggerIngest}
            compact={true}
          />
        </div>
      </main>

      {/* ── Lead Feed ── */}
      <LeadFeed
        leads={leads}
        savedLeadIds={savedLeadIds}
        feedWidth={feedWidth}
        mobileFeedOpen={mobileFeedOpen}
        setMobileFeedOpen={setMobileFeedOpen}
        setIsResizing={(_) => handleResizeStart()}
        toggleSave={toggleSave}
        setPreviewLead={setPreviewLead}
        category={category}
      />

      {/* Mobile FAB — open lead feed */}
      <button
        onClick={() => setMobileFeedOpen(true)}
        className="lg:hidden fixed bottom-6 right-6 z-30 w-14 h-14 rounded-full bg-indigo-600 hover:bg-indigo-500 shadow-[0_0_30px_rgba(79,70,229,0.4)] flex items-center justify-center transition"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2"><path d="M4 6h16M4 12h16M4 18h7"/></svg>
        {leads.length > 0 && (
          <span className="absolute -top-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full text-[10px] text-white flex items-center justify-center font-bold">
            {leads.length > 99 ? '99+' : leads.length}
          </span>
        )}
      </button>
    </div>
  )
}
