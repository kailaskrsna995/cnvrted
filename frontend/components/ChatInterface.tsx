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
  stats?: { total: number; qualified: number; urgent: number; saved: number }
  recentLeads?: Lead[]
  compact?: boolean
}) {
  return (
    <div className="flex flex-col h-full relative z-10 w-full max-w-4xl mx-auto px-5 md:px-10 py-8 md:py-12">

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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto mb-6 custom-scrollbar pr-2 flex flex-col gap-6" style={{ minHeight: chatMessages.length > 0 ? '400px' : 'auto' }}>
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
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {msg.text}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-[14px] leading-relaxed">{msg.text}</p>
                )}

                {msg.scanParams && msg.scanParams.keywords && msg.scanParams.keywords.length > 0 && (
                  <button
                    onClick={() => triggerIngest(msg.scanParams!)}
                    className="mt-4 flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-[12px] font-medium px-4 py-2 rounded-xl transition shadow-[0_0_15px_rgba(79,70,229,0.2)]"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                    Find leads for this
                  </button>
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
      <div className="bg-[#0a0a0f] border border-white/10 rounded-2xl p-3 shadow-2xl shrink-0">
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

      {/* Quick searches + insights (only when no messages) */}
      <AnimatePresence>
        {chatMessages.length === 0 && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: 0.3 }}
            className="mt-8 flex flex-col gap-10"
          >
            {/* Try searching chips */}
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

            {/* Insights at a glance */}
            {stats && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <span className="text-[13px] text-white font-medium">Insights at a glance</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    {
                      label: 'New buyer signals',
                      sub: 'today',
                      value: stats.total,
                      color: 'text-indigo-400',
                      stroke: '#6366f1',
                      sparkline: SPARKLINES[0],
                    },
                    {
                      label: 'Qualified leads',
                      sub: 'score ≥ 60',
                      value: stats.qualified,
                      color: 'text-emerald-400',
                      stroke: '#34d399',
                      sparkline: SPARKLINES[1],
                    },
                    {
                      label: 'Urgent',
                      sub: 'need attention',
                      value: stats.urgent,
                      color: 'text-amber-400',
                      stroke: '#fbbf24',
                      sparkline: SPARKLINES[2],
                    },
                    {
                      label: 'Leads saved',
                      sub: 'this week',
                      value: stats.saved,
                      color: 'text-violet-400',
                      stroke: '#a78bfa',
                      sparkline: SPARKLINES[3],
                    },
                  ].map((card) => (
                    <div
                      key={card.label}
                      className="bg-[#0a0a0f] border border-white/5 rounded-2xl p-4 flex flex-col gap-2 hover:border-white/10 transition"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="text-[11px] text-gray-500 mb-0.5">{card.label}</p>
                          <p className={`text-3xl font-semibold ${card.color} leading-none`}>{card.value}</p>
                          <p className="text-[10px] text-gray-600 mt-1">{card.sub}</p>
                        </div>
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
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                        lead.platform === 'reddit' ? 'bg-orange-500/10 text-orange-400' :
                        lead.platform === 'twitter' ? 'bg-gray-700 text-gray-300' :
                        'bg-indigo-500/10 text-indigo-400'
                      }`}>
                        {lead.platform === 'reddit' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>
                        ) : lead.platform === 'twitter' ? (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.763l7.738-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                        ) : (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                        )}
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
    </div>
  )
}
