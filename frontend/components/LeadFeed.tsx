'use client'

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
  category
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
}) {
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

        <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between shrink-0 bg-[#050508] z-10">
          <span className="text-[13px] font-medium text-white">Lead feed</span>
          <div className="flex items-center gap-3">
            <button className="text-gray-400 hover:text-white transition">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M1 14h6"/><path d="M9 8h6"/><path d="M17 16h6"/></svg>
            </button>
            <button onClick={() => setMobileFeedOpen(false)} className="lg:hidden text-gray-400 hover:text-white transition p-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-4 custom-scrollbar">
          {leads.length === 0 ? (
            <EmptyState type={category === 'Saved' ? 'Saved' : 'Leads'} />
          ) : (
            <div className="flex flex-col gap-3">
              <AnimatePresence>
                {leads.map((lead, i) => {
                  const initials = (lead.author || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
                  const isHot = lead.timeline === 'Urgent'
                  const isWarm = lead.timeline === 'Active'

                  return (
                    <motion.div
                      layout
                      initial={{ opacity: 0, y: 20, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
                      transition={{ duration: 0.3, delay: Math.min(i * 0.05, 0.5) }}
                      key={lead.id || lead.lead_id}
                      className="bg-[#0a0a0f] border border-white/5 rounded-2xl p-4 hover:border-white/10 transition group cursor-pointer"
                      onClick={() => setPreviewLead(lead)}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">
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

                      {/* Content */}
                      <p className="text-[12px] text-gray-300 leading-relaxed mb-3 line-clamp-4">
                        {lead.post_text || lead.exact_need}
                      </p>

                      {/* Tags */}
                      <div className="flex flex-wrap gap-2 mb-4">
                        {(lead.exact_need?.toLowerCase().includes('budget') || lead.post_text?.toLowerCase().includes('budget')) && (
                          <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-400">Budget included</span>
                        )}
                        {lead.platform && (
                          <span className={`px-2.5 py-1 rounded-md border text-[10px] capitalize ${
                            lead.platform === 'reddit' ? 'bg-orange-500/10 border-orange-500/20 text-orange-400' :
                            lead.platform === 'twitter' ? 'bg-white/5 border-white/10 text-gray-400' :
                            'bg-blue-500/10 border-blue-500/20 text-blue-400'
                          }`}>
                            {lead.platform === 'twitter' ? 'X' : lead.platform}
                          </span>
                        )}
                        <span className="px-2.5 py-1 rounded-md bg-white/5 border border-white/5 text-[10px] text-gray-400">{lead.category || 'General'}</span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center justify-between pt-3 border-t border-white/5">
                        <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                          <button onClick={() => toggleSave(lead)} className={`w-8 h-8 rounded-lg flex items-center justify-center transition ${savedLeadIds.has(lead.lead_id) ? 'text-indigo-400' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill={savedLeadIds.has(lead.lead_id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                          </button>
                          <button className="w-8 h-8 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 flex items-center justify-center transition">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                          </button>
                        </div>
                        <button className="px-4 py-1.5 rounded-lg bg-indigo-600/20 text-indigo-400 text-[11px] font-medium hover:bg-indigo-600 hover:text-white transition" onClick={e => e.stopPropagation()}>
                          Contact
                        </button>
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
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
