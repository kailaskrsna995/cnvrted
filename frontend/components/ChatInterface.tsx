'use client'

import { motion, AnimatePresence } from 'framer-motion'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { RefObject } from 'react'

export type ChatMsg = { role: 'user' | 'ai'; text: string; scanParams?: { domain: string; keywords: string[] } }

export function ChatInterface({
  chatMessages,
  chatLoading,
  chatEndRef,
  searchQuery,
  setSearchQuery,
  sendChat,
  triggerIngest
}: {
  chatMessages: ChatMsg[]
  chatLoading: boolean
  chatEndRef: RefObject<HTMLDivElement | null>
  searchQuery: string
  setSearchQuery: (q: string) => void
  sendChat: () => void
  triggerIngest: (params: { domain: string; keywords: string[] }) => void
}) {
  return (
    <div className="flex flex-col h-full relative z-10 w-full max-w-4xl mx-auto px-5 md:px-10 py-8 md:py-12">

      {/* Header (only when no messages) */}
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

      {/* Quick searches (only when no messages) */}
      <AnimatePresence>
        {chatMessages.length === 0 && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, height: 0, overflow: 'hidden' }}
            transition={{ duration: 0.3 }}
            className="mt-8"
          >
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
