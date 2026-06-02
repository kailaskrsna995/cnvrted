'use client'

import { useState } from 'react'
import { Lead } from '../lib/types'
import { formatRelativeTime } from '../lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { EmptyState } from './EmptyState'

export function LeadFeed({
  leads,
  savedLeadIds,
  feedWidth,
  mobileFeedOpen,
  setMobileFeedOpen,
  setIsResizing,
  toggleSave,
  setPreviewLead,
  category,
  scanning
}: {
  leads: Lead[]
  savedLeadIds: Set<string>
  feedWidth: number
  mobileFeedOpen: boolean
  setMobileFeedOpen: (open: boolean) => void
  setIsResizing: (resizing: boolean) => void
  toggleSave: (lead: Lead) => void
  setPreviewLead: (lead: Lead | null) => void
  category: string
  scanning?: boolean
}) {
  const [likedLeads,     setLikedLeads]     = useState<Set<string>>(new Set())
  const [dislikedLeads,  setDislikedLeads]  = useState<Set<string>>(new Set())
  const [revealedLeads,  setRevealedLeads]  = useState<Set<string>>(new Set())

  const toggleLike = (id: string) => {
    setLikedLeads(prev => {
      const s = new Set(prev)
      if (s.has(id)) { s.delete(id) } else { s.add(id); setDislikedLeads(d => { const x = new Set(d); x.delete(id); return x }) }
      return s
    })
  }
  const toggleDislike = (id: string) => {
    setDislikedLeads(prev => {
      const s = new Set(prev)
      if (s.has(id)) { s.delete(id) } else { s.add(id); setLikedLeads(d => { const x = new Set(d); x.delete(id); return x }) }
      return s
    })
  }

  // Hide disliked leads from the feed
  const visibleLeads = leads.filter(l => !dislikedLeads.has(l.lead_id))

  return (
    <>
      <AnimatePresence>
        {mobileFeedOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm"
            onClick={() => setMobileFeedOpen(false)}
          />
        )}
      </AnimatePresence>

      <aside
        style={{ width: typeof window !== 'undefined' && window.innerWidth < 1024 ? '100%' : feedWidth }}
        className={`fixed lg:relative right-0 z-50 bg-[#050508] border-l border-white/5 flex flex-col h-screen shrink-0 transition-transform duration-300 ease-in-out ${mobileFeedOpen ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'}`}
      >
        {/* Resize handle */}
        <div
          onMouseDown={() => setIsResizing(true)}
          className="absolute left-0 top-0 bottom-0 w-1.5 -ml-[3px] cursor-col-resize hover:bg-indigo-500/50 transition-colors z-50 hidden lg:block"
        />

        {/* Header */}
        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#050508] z-10">
          <span className="text-[13px] font-medium text-white">Lead feed</span>
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileFeedOpen(false)} className="lg:hidden text-gray-400 hover:text-white transition p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        {/* Scroll container — overscroll-contain stops jitter on Windows */}
        <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
          {scanning && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-4 rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 flex flex-col items-center gap-4"
            >
              <div className="flex items-center gap-6">
                {/* LinkedIn logo */}
                <motion.div
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div className="w-10 h-10 rounded-xl bg-[#0A66C2]/15 flex items-center justify-center">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="#0A66C2"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                  </div>
                  <span className="text-[9px] text-[#0A66C2] font-medium">LinkedIn</span>
                </motion.div>

                {/* Animated dots */}
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.span
                      key={i}
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                      className="w-1 h-1 rounded-full bg-indigo-400"
                    />
                  ))}
                </div>

                {/* X logo */}
                <motion.div
                  animate={{ opacity: [1, 0.3, 1] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  className="flex flex-col items-center gap-1.5"
                >
                  <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#e7e9ea"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                  </div>
                  <span className="text-[9px] text-gray-400 font-medium">X / Twitter</span>
                </motion.div>
              </div>

              {/* Scanning text */}
              <div className="flex items-center gap-2">
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  className="w-3.5 h-3.5 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full"
                />
                <span className="text-[11px] text-indigo-300 tracking-wide">Scanning for leads…</span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 rounded-full bg-white/5 overflow-hidden">
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-1/3 h-full bg-gradient-to-r from-transparent via-indigo-500 to-transparent rounded-full"
                />
              </div>
            </motion.div>
          )}

          {visibleLeads.length === 0 && !scanning ? (
            <EmptyState type={category === 'Saved' ? 'Saved' : 'Leads'} />
          ) : (
            <div className="flex flex-col gap-3">
              {visibleLeads.map((lead, i) => {
                const initials  = (lead.author || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
                const isHot     = lead.timeline === 'Urgent'
                const isWarm    = lead.timeline === 'Active'
                const isLiked   = likedLeads.has(lead.lead_id)
                const hasContact = !!(lead.contact_email || lead.contact_phone)
                const isRevealed = revealedLeads.has(lead.lead_id)

                return (
                  <motion.div
                    key={lead.id || lead.lead_id}
                    /* No `layout` prop — it causes reflow-based animations that
                       stutter on Windows when scrolling. Entrance animation only. */
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25, delay: Math.min(i * 0.04, 0.4) }}
                    className={`bg-[#0a0a0f] border rounded-2xl p-4 hover:border-white/10 transition group cursor-pointer ${
                      isLiked ? 'border-emerald-500/25' : 'border-white/5'
                    }`}
                    onClick={() => setPreviewLead(lead)}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold shrink-0">
                          {initials}
                        </div>
                        <div>
                          <p className="text-[13px] font-medium text-white truncate max-w-[120px]">{lead.author}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500">{formatRelativeTime(lead.posted_at || lead.ingested_at)}</span>
                        <span className="text-[10px] font-bold text-emerald-400">{lead.intent_score}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-[#181820] text-indigo-300 font-medium">
                          {isHot ? 'Hot' : isWarm ? 'Warm' : 'Cool'}
                        </span>
                      </div>
                    </div>

                    {/* Post text */}
                    <p className="text-[12px] text-gray-300 leading-relaxed mb-3 line-clamp-4">
                      {lead.post_text || lead.exact_need}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap gap-2 mb-4">
                      {(lead.exact_need?.toLowerCase().includes('budget') || lead.post_text?.toLowerCase().includes('budget')) && (
                        <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-400">Budget included</span>
                      )}
                      {lead.platform && (
                        <span className={`px-2 py-1 rounded-md border flex items-center gap-1 ${
                          lead.platform === 'reddit'  ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                          lead.platform === 'twitter' ? 'bg-white/5 border-white/10 text-gray-300' :
                          'bg-blue-500/10 border-blue-500/20 text-[#0A66C2]'
                        }`}>
                          {lead.platform === 'twitter' ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.746l7.73-8.835L1.254 2.25H8.08l4.259 5.631 5.905-5.631zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                          ) : lead.platform === 'linkedin' ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>
                          ) : (
                            <span className="text-[10px]">{lead.platform}</span>
                          )}
                        </span>
                      )}
                      <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-400">{lead.category || 'General'}</span>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center justify-between pt-3 border-t border-white/5" onClick={e => e.stopPropagation()}>

                      {/* Left: save + like + dislike */}
                      <div className="flex gap-1.5">
                        {/* Bookmark / save */}
                        <button
                          onClick={() => toggleSave(lead)}
                          title="Save lead"
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                            savedLeadIds.has(lead.lead_id)
                              ? 'text-indigo-400 bg-indigo-500/10'
                              : 'text-gray-500 hover:text-white hover:bg-white/5'
                          }`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={savedLeadIds.has(lead.lead_id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                        </button>

                        {/* Thumbs up */}
                        <button
                          onClick={() => toggleLike(lead.lead_id)}
                          title="Good lead"
                          className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${
                            isLiked
                              ? 'text-emerald-400 bg-emerald-500/10'
                              : 'text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10'
                          }`}
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill={isLiked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
                            <path d="M7 10v12"/><path d="M15 5.88 14 10h5.83a2 2 0 0 1 1.92 2.56l-2.33 8A2 2 0 0 1 17.5 22H4a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2h2.76a2 2 0 0 0 1.79-1.11L12 2a3.13 3.13 0 0 1 3 3.88Z"/>
                          </svg>
                        </button>

                        {/* Thumbs down */}
                        <button
                          onClick={() => toggleDislike(lead.lead_id)}
                          title="Not relevant"
                          className="w-8 h-8 rounded-lg flex items-center justify-center text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition"
                        >
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M17 14V2"/><path d="M9 18.12 10 14H4.17a2 2 0 0 1-1.92-2.56l2.33-8A2 2 0 0 1 6.5 2H20a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.76a2 2 0 0 0-1.79 1.11L14 22a3.13 3.13 0 0 1-3-3.88Z"/>
                          </svg>
                        </button>
                      </div>

                      {/* Right: contact reveal */}
                      {hasContact ? (
                        isRevealed ? (
                          <span className="text-[11px] text-emerald-400 font-mono truncate max-w-[160px]">
                            {lead.contact_email || lead.contact_phone}
                          </span>
                        ) : (
                          <button
                            onClick={() => setRevealedLeads(prev => new Set([...prev, lead.lead_id]))}
                            className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-[11px] font-medium border border-emerald-500/30 hover:bg-emerald-500/25 transition"
                          >
                            Reveal contact ✦
                          </button>
                        )
                      ) : (
                        <button
                          disabled
                          className="px-3 py-1.5 rounded-lg bg-white/3 text-gray-600 text-[11px] font-medium border border-white/5 cursor-not-allowed select-none"
                        >
                          No contact
                        </button>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}

          {leads.length > 0 && (
            <div className="mt-4 flex justify-center pb-4">
              <button className="text-[11px] text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1">
                View all leads <span className="text-[10px]">→</span>
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  )
}
