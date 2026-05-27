'use client'

import { useState } from 'react'
import { Lead } from '../lib/types'
import { formatDate } from '../lib/utils'

export function PostPreviewModal({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [outreachCopied, setOutreachCopied] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-[#07070a] border border-white/10 w-full max-w-2xl mx-4 shadow-2xl rounded-2xl overflow-hidden" onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-sm font-semibold shrink-0">
              {lead.author?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-[15px] font-medium text-white">{lead.author}</p>
              {lead.profession && <p className="text-[12px] text-gray-500 mt-0.5">{lead.profession}</p>}
            </div>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition text-lg leading-none">✕</button>
        </div>

        <div className="px-6 py-5 max-h-96 overflow-y-auto custom-scrollbar">
          {lead.exact_need && (
            <div className="border-l-2 border-indigo-500 pl-3 mb-4">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-1">Looking for</p>
              <p className="text-[15px] text-white">{lead.exact_need}</p>
            </div>
          )}
          {lead.outreach_line && (
            <div className="mb-4 bg-[#0a0a0f] border border-white/5 rounded-xl px-3 py-2.5">
              <p className="text-[11px] text-gray-500 uppercase tracking-widest mb-1.5">Your opening line</p>
              <p className="text-[13px] text-gray-300 italic mb-2">&ldquo;{lead.outreach_line}&rdquo;</p>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(lead.outreach_line!)
                  setOutreachCopied(true)
                  setTimeout(() => setOutreachCopied(false), 2000)
                }}
                className="text-[11px] text-indigo-400 border border-indigo-500/30 px-3 py-1 rounded-lg hover:bg-indigo-500/10 transition"
              >
                {outreachCopied ? '✓ Copied' : 'Copy'}
              </button>
            </div>
          )}
          <p className="text-[13px] text-gray-400 leading-relaxed whitespace-pre-wrap">{lead.post_text}</p>
        </div>

        <div className="px-6 py-4 border-t border-white/5 flex justify-between items-center">
          <span className="text-[12px] text-gray-500">{formatDate(lead.posted_at || lead.ingested_at)}</span>
          {lead.source_url ? (
            <a
              href={lead.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[12px] bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded-lg transition"
            >
              {lead.platform === 'reddit' ? 'Open on Reddit ↗' : lead.platform === 'twitter' ? 'Open on X ↗' : 'Open on LinkedIn ↗'}
            </a>
          ) : (
            <span className="text-[12px] text-gray-600">No source URL</span>
          )}
        </div>
      </div>
    </div>
  )
}
