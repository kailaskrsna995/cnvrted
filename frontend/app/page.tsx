'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Lead = {
  id: string
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

const CATEGORIES = ['All', 'AI Automation', 'Marketing']

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

export default function Dashboard() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [category, setCategory] = useState('All')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)

  const fetchLeads = async (cat: string) => {
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

  const triggerIngest = async () => {
    setLoading(true)
    try { await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ingest/`, { method: 'POST' }) } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchLeads(category)
    fetchStats()
    const channel = supabase.channel('leads-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
        fetchLeads(category)
        fetchStats()
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [category])

  return (
    <div className="h-screen flex overflow-hidden grid-bg">

      {/* Sidebar — fixed, non-scrollable */}
      <aside className="w-52 border-r border-black/10 bg-white/80 backdrop-blur flex flex-col h-screen shrink-0">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-black/10">
          <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-black">cnvrted</span>
        </div>

        {/* Scan button */}
        <div className="px-4 pt-4">
          <button
            onClick={triggerIngest}
            disabled={loading}
            className="font-mono-custom w-full border border-black text-black text-xs px-3 py-2 uppercase tracking-widest hover:bg-black hover:text-white transition disabled:opacity-40"
          >
            {loading ? 'Scanning...' : '⚡ Scan'}
          </button>
        </div>

        {/* Categories */}
        <nav className="flex flex-col gap-0.5 px-3 pt-5 flex-1">
          <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest px-2 mb-2">Feeds</p>
          {CATEGORIES.map(cat => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`font-mono-custom w-full text-left px-2 py-2 text-xs flex justify-between items-center transition uppercase tracking-wide
                ${category === cat ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-100'}`}
            >
              <span>{cat}</span>
              {cat !== 'All' && (
                <span className={`text-xs px-1.5 py-0.5 ${category === cat ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500'}`}>
                  {stats[cat] || 0}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="px-5 pb-5"></div>
      </aside>

      {/* Main feed — scrollable */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between px-8 py-4 border-b border-black/10 bg-white/70 backdrop-blur shrink-0">
          <h1 className="font-canela text-2xl font-light text-black tracking-tight">
            {category === 'All' ? 'All Intent Signals' : category}
          </h1>
          <span className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">{leads.length} leads</span>
        </div>

        {/* Leads */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          {leads.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-gray-300">
              <p className="font-canela text-5xl mb-3 font-light">📡</p>
              <p className="font-mono-custom text-xs uppercase tracking-widest">No signals yet — run a scan</p>
            </div>
          )}

          <div className="flex flex-col gap-4 max-w-4xl">
            {leads.map(lead => (
              <div key={lead.id} className="bg-white border border-black/10 p-6 hover:border-black/30 hover:shadow-md transition">

                {/* Header */}
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
                  </div>
                </div>

                {/* Looking for */}
                {lead.exact_need && (
                  <div className="border-l-2 border-black pl-3 mb-4">
                    <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Looking for</p>
                    <p className="font-canela text-base text-black">{lead.exact_need}</p>
                  </div>
                )}

                {/* Post text */}
                <p className="text-gray-500 text-sm leading-relaxed line-clamp-3 mb-4">{lead.post_text}</p>

                {/* Footer */}
                <div className="flex flex-wrap items-center gap-4 pt-3 border-t border-gray-100">
                  <span className="font-mono-custom text-xs text-gray-400">
                    ✉ {lead.contact_email || 'Unavailable'}
                  </span>
                  <span className="font-mono-custom text-xs text-gray-400">
                    📞 {lead.contact_phone || 'Unavailable'}
                  </span>
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
