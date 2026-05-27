'use client'

import { motion } from 'framer-motion'

export function EmptyState({ type }: { type: 'Leads' | 'Saved' }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="w-16 h-16 rounded-2xl bg-[#0a0a0f] border border-white/5 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(99,102,241,0.1)]"
      >
        {type === 'Saved' ? (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
        ) : (
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
        )}
      </motion.div>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="text-[14px] font-medium text-white mb-2"
      >
        {type === 'Saved' ? 'No saved leads yet' : 'No leads found'}
      </motion.p>
      <motion.p
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="text-[12px] text-gray-500 leading-relaxed"
      >
        {type === 'Saved'
          ? 'Bookmark leads from the feed to save them here.'
          : 'Tell the AI what your agency does to find buyers.'}
      </motion.p>
    </div>
  )
}
