'use client'

import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RefObject } from 'react'
import { Lead } from '../lib/types'
import { formatRelativeTime } from '../lib/utils'

export type ChatMsg = { role: 'user' | 'ai'; text: string; scanParams?: { domain: string; keywords: string[] } }

const SPARKLINES = [
  'M0 18 L12 12 L24 15 L36 8 L48 11 L60 5 L72 9 L84 4',
  'M0 16 L12 10 L24 14 L36 6 L48 10 L60 4 L72 8 L84 6',
  'M0 14 L12 18 L24 10 L36 14 L48 8 L60 12 L72 6 L84 10',
  'M0 12 L12 8 L24 16 L36 10 L48 14 L60 8 L72 12 L84 6',
]

export type ChatStats = {
  total: number
  qualified: number
  urgent: number
  saved: number
  scanTotal?: number
  scanRejected?: number
  linkedin?: number
  twitter?: number
  reddit?: number
  categoryStats?: Record<string, number>
  greeting?: string
}

export function ChatInterface({
  chatMessages,
  chatLoading,
  chatEndRef,
  searchQuery,
  setSearchQuery,
  sendChat,
  triggerIngest,
  stats,
  recentLeads,
  compact,
}: {
  chatMessages: ChatMsg[]
  chatLoading: boolean
  chatEndRef: RefObject<HTMLDivElement | null>
  searchQuery: string
  setSearchQuery: (q: string) => void
  sendChat: () => void
  triggerIngest: (params: { domain: string; keywords: string[] }) => void
  stats?: ChatStats
  recentLeads?: Lead[]
  compact?: boolean
}) {
  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10">
      <div className="w-full max-w-4xl mx-auto px-5 md:px-8 py-6 md:py-8 flex flex-col min-h-full">

      {/* Header (only when no messages and not compact) */}
      {!compact && (
        <AnimatePresence>
          {chatMessages.length === 0 && (
            <motion.div
              initial={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20, height: 0, marginBottom: 0, overflow: 'hidden' }}
              transition={{ duration: 0.3 }}
              className="mb-10 relative"
            >
              <h1 className="text-[40px] md:text-[44px] font-medium text-white mb-4 leading-tight tracking-tight">
                What buyers are<br/>you looking for today?
              </h1>
              <p className="text-gray-400 text-[15px]">Your AI sales rep that finds buyers before they find you.</p>
            </motion.div>
          )}
        </AnimatePresence>
      )}

      {/* Messages — single scroll container (stats pinned at top in compact mode) */}
      <div className="flex-1 flex flex-col gap-5 mb-5">

        {/* ── Compact mode: greeting + stats + charts live inside the scroll ── */}
        {compact && stats && (
          <div className="pb-6 border-b border-white/5 flex flex-col gap-5">

            {/* Greeting */}
            {stats.greeting && (
              <div className="text-center pt-2 pb-4">
                <div className="flex items-center justify-center gap-2 mb-4">
                  <span className="font-mono-custom font-bold tracking-[0.3em] text-[16px] uppercase text-white">cnvrted</span>
                  <span className="font-mono-custom text-[10px] text-white/40 border border-white/20 px-1.5 py-0.5 rounded uppercase tracking-widest font-semibold leading-none">beta</span>
                </div>
                <h2 className="font-canela text-[40px] font-light text-white leading-tight mb-2">
                  {stats.greeting}
                </h2>
                <p className="font-mono-custom text-[10px] text-gray-500 uppercase tracking-[0.25em]">
                  Your AI sales rep that finds buyers before they find you
                </p>
              </div>
            )}

            {/* 4 stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Total Leads',    value: stats.total,     sub: 'all time' },
                { label: 'Qualified',      value: stats.qualified, sub: 'score ≥ 60' },
                { label: 'Urgent',         value: stats.urgent,    sub: 'need reply now' },
                { label: 'Posts Scanned',  value: stats.scanTotal ?? 0, sub: `${stats.scanRejected ?? 0} rejected` },
              ].map(card => (
                <div key={card.label} className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 hover:border-white/10 transition">
                  <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-1.5">{card.label}</p>
                  <p className="text-2xl font-semibold text-white leading-none mb-1">{card.value}</p>
                  <p className="text-[9px] text-gray-600">{card.sub}</p>
                </div>
              ))}
            </div>

            {/* Leads by source + Top industries */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Source */}
              <div className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5">
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-3">Leads by Source</p>
                {stats.total > 0 ? (
                  <div className="flex flex-col gap-2">
                    {[
                      { label: 'LinkedIn',   count: stats.linkedin ?? 0,  color: 'bg-blue-500' },
                      { label: 'X / Twitter',count: stats.twitter  ?? 0,  color: 'bg-gray-400' },
                      { label: 'Reddit',     count: stats.reddit   ?? 0,  color: 'bg-orange-500' },
                    ].filter(s => s.count > 0).map(s => (
                      <div key={s.label} className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400 w-20 shrink-0">{s.label}</span>
                        <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                          <div className={`h-full ${s.color} rounded-full`} style={{ width: `${Math.round((s.count / stats.total) * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-500 w-8 text-right tabular-nums">
                          {Math.round((s.count / stats.total) * 100)}%
                        </span>
                      </div>
                    ))}
                    {(stats.linkedin ?? 0) === 0 && (stats.twitter ?? 0) === 0 && (stats.reddit ?? 0) === 0 && (
                      <p className="text-[11px] text-gray-600">No source data yet</p>
                    )}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600">No data yet — run a scan first</p>
                )}
              </div>

              {/* Industries */}
              <div className="bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5">
                <p className="text-[9px] text-gray-500 uppercase tracking-widest mb-3">Top Industries</p>
                {stats.categoryStats && Object.keys(stats.categoryStats).filter(k => k && k !== 'None').length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {Object.entries(stats.categoryStats)
                      .filter(([k]) => k && k !== 'None')
                      .sort(([, a], [, b]) => b - a)
                      .slice(0, 4)
                      .map(([cat, count]) => (
                        <div key={cat} className="flex items-center gap-2">
                          <span className="text-[11px] text-gray-400 flex-1 truncate">{cat}</span>
                          <div className="w-16 h-1.5 bg-gray-800 rounded-full overflow-hidden shrink-0">
                            <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${Math.round((count / stats.total) * 100)}%` }} />
                          </div>
                          <span className="text-[10px] text-gray-500 w-8 text-right tabular-nums shrink-0">
                            {Math.round((count / stats.total) * 100)}%
                          </span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600">No data yet — run a scan first</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Messages ── */}
        <AnimatePresence initial={false}>
          {chatMessages.map((msg, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[85%] rounded-2xl p-5 ${msg.role === 'user' ? 'bg-indigo-600/20 border border-indigo-500/20 text-indigo-100' : 'bg-[#0a0a0f] border border-white/5 text-gray-300'}`}>
                {msg.role === 'ai' ? (
                  <div className="prose prose-invert prose-sm max-w-none text-[14px]">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[14px] leading-relaxed">{msg.text}</p>
                )}
                {msg.scanParams && msg.scanParams.keywords && msg.scanParams.keywords.length > 0 && (
                  <div className="mt-4">
                    <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-2">Search phrases</p>
                    <ul className="flex flex-col gap-1.5 mb-4">
                      {msg.scanParams.keywords.map((kw, ki) => (
                        <li key={ki} className="flex items-start gap-2 text-[12px] text-gray-300">
                          <span className="text-indigo-400 mt-0.5 shrink-0">→</span>
                          <span>{kw}</span>
                        </li>
                      ))}
                    </ul>
                    <button
                      onClick={() => triggerIngest(msg.scanParams!)}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium px-4 py-2 rounded-xl transition shadow-[0_0_15px_rgba(79,70,229,0.2)]"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                      Find leads for this
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* Typing indicator */}
        <AnimatePresence>
          {chatLoading && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="flex justify-start"
            >
              <div className="bg-[#0a0a0f] border border-white/5 rounded-2xl p-4 flex items-center gap-1.5 h-12">
                <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0 }} className="w-2 h-2 bg-indigo-400 rounded-full" />
                <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.2 }} className="w-2 h-2 bg-indigo-400 rounded-full" />
                <motion.div animate={{ y: [0, -5, 0] }} transition={{ duration: 0.6, repeat: Infinity, delay: 0.4 }} className="w-2 h-2 bg-indigo-400 rounded-full" />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        <div ref={chatEndRef} />
      </div>

      {/* Input */}
      <div className="bg-[#0a0a0f] border border-white/10 rounded-2xl p-3 shadow-2xl sticky bottom-4 shrink-0">
        <form onSubmit={(e) => { e.preventDefault(); sendChat() }} className="flex flex-col">
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder={chatMessages.length === 0 ? "e.g. We're a video production agency for SaaS brands..." : "Ask follow-up or provide more details..."}
            className="w-full bg-transparent text-white text-[15px] placeholder:text-gray-500 outline-none px-3 pt-2 pb-6"
            disabled={chatLoading}
          />
          <div className="flex items-center justify-between px-2">
            <div className="flex gap-2">
              <button type="button" className="text-gray-500 hover:text-gray-300 transition text-[12px] flex items-center gap-1">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                Upload CSV
              </button>
            </div>
            <button
              type="submit"
              disabled={!searchQuery.trim() || chatLoading}
              className="w-10 h-10 rounded-full bg-indigo-600 hover:bg-indigo-500 transition flex items-center justify-center text-white shadow-[0_0_15px_rgba(79,70,229,0.4)] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            </button>
          </div>
        </form>
      </div>

      {/* Quick searches (non-compact mode, no messages) */}
      {!compact && (
        <AnimatePresence>
          {chatMessages.length === 0 && (
            <motion.div
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
              transition={{ duration: 0.3 }}
              className="mt-8 flex flex-col gap-10"
            >
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] text-gray-400 font-medium">Try searching</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { icon: '▷', label: 'Video editors for startups' },
                    { icon: '▦', label: 'SaaS companies hiring' },
                    { icon: 'in', label: 'LinkedIn leads' },
                    { icon: '📍', label: 'US based agencies' },
                  ].map(q => (
                    <button
                      key={q.label}
                      type="button"
                      onClick={() => setSearchQuery(q.label)}
                      className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0a0a0f] border border-white/5 hover:bg-white/5 transition"
                    >
                      <span className="text-gray-500 text-[10px]">{q.icon}</span>
                      <span className="text-[12px] text-gray-300">{q.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Sparkline insights (non-compact, no messages) */}
              {stats && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-white font-medium">Insights at a glance</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: 'New buyer signals', sub: 'today',        value: stats.total,     color: 'text-indigo-400', stroke: '#6366f1', sparkline: SPARKLINES[0] },
                      { label: 'Qualified leads',   sub: 'score ≥ 60',  value: stats.qualified, color: 'text-emerald-400', stroke: '#34d399', sparkline: SPARKLINES[1] },
                      { label: 'Urgent',            sub: 'need attention', value: stats.urgent,  color: 'text-amber-400',  stroke: '#fbbf24', sparkline: SPARKLINES[2] },
                      { label: 'Leads saved',       sub: 'this week',   value: stats.saved,     color: 'text-violet-400', stroke: '#a78bfa', sparkline: SPARKLINES[3] },
                    ].map(card => (
                      <div key={card.label} className="bg-[#0a0a0f] border border-white/5 rounded-2xl p-4 flex flex-col gap-2 hover:border-white/10 transition">
                        <div>
                          <p className="text-[11px] text-gray-500 mb-0.5">{card.label}</p>
                          <p className={`text-3xl font-semibold ${card.color} leading-none`}>{card.value}</p>
                          <p className="text-[10px] text-gray-600 mt-1">{card.sub}</p>
                        </div>
                        <svg width="100%" height="24" viewBox="0 0 84 24" fill="none" preserveAspectRatio="none">
                          <path d={card.sparkline} stroke={card.stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
                        </svg>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent activity */}
              {recentLeads && recentLeads.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] text-white font-medium">Recent activity</span>
                    <span className="text-[11px] text-gray-500">View all →</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {recentLeads.slice(0, 4).map((lead, i) => (
                      <div key={lead.id || i} className="flex items-center gap-3 px-4 py-3 bg-[#0a0a0f] border border-white/5 rounded-xl hover:border-white/10 transition">
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${lead.platform === 'reddit' ? 'bg-orange-500/10 text-orange-400' : lead.platform === 'twitter' ? 'bg-gray-700 text-gray-300' : 'bg-indigo-500/10 text-indigo-400'}`}>
                          <span className="text-[10px] font-bold">{lead.platform === 'reddit' ? 'R' : lead.platform === 'twitter' ? 'X' : 'in'}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] text-white truncate">{lead.author}</p>
                          <p className="text-[11px] text-gray-500 truncate">{lead.exact_need || lead.post_text?.slice(0, 60) || 'New buyer signal'}</p>
                        </div>
                        <span className="text-[11px] text-gray-600 shrink-0">{formatRelativeTime(lead.ingested_at)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      )}
      </div>
    </div>
  )
}
