'use client'

export function Sidebar({
  mobileNavOpen,
  setMobileNavOpen,
  category,
  setCategory,
  firstName,
  setProfileOpen,
  stats,
  savedLeadIds,
}: {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  category: string
  setCategory: (cat: string) => void
  firstName: string
  setProfileOpen: (open: boolean) => void
  stats: Record<string, number>
  savedLeadIds: Set<string>
}) {
  const categoryKeys = Object.keys(stats).filter(k => k && k !== 'None' && k !== 'null')

  return (
    <>
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`fixed md:relative z-50 w-[220px] border-r border-white/5 flex flex-col h-screen shrink-0 bg-[#050508] transition-transform duration-300 ease-in-out ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>

        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-bold tracking-[0.28em] text-[13px] uppercase text-white">cnvrted</span>
            <span className="text-[8px] text-white/40 border border-white/20 px-1.5 py-0.5 rounded-sm uppercase tracking-widest font-semibold leading-none">beta</span>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 flex flex-col overflow-hidden min-h-0">

          {/* Overview */}
          <div className="px-3 pt-4 pb-2 shrink-0">
            <button
              onClick={() => setCategory('All')}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg transition ${category === 'All' ? 'bg-white text-black' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
              <span className="text-[12px] font-semibold tracking-wide uppercase">Overview</span>
            </button>
          </div>

          {/* Categories */}
          {categoryKeys.length > 0 && (
            <div className="px-3 shrink-0">
              <p className="text-[9px] text-gray-600 uppercase tracking-widest px-3 mb-1.5 mt-2">Categories</p>
            </div>
          )}
          <div className="flex-1 overflow-y-auto custom-scrollbar px-3 pb-2">
            <div className="flex flex-col gap-0.5">
              {categoryKeys.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategory(cat)}
                  className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition ${category === cat ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
                >
                  <span className="text-[11px] font-medium uppercase tracking-wide truncate text-left flex-1 mr-2">{cat}</span>
                  <span className="text-[10px] text-gray-600 shrink-0 tabular-nums">{stats[cat] || 0}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Saved + Need Help */}
          <div className="px-3 pb-3 shrink-0 border-t border-white/5 pt-3">
            <button
              onClick={() => setCategory('Saved')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition mb-1 ${category === 'Saved' ? 'bg-white/10 text-white' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`}
            >
              <div className="flex items-center gap-2.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill={category === 'Saved' ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
                <span className="text-[12px] font-semibold tracking-wide uppercase">Saved</span>
              </div>
              {savedLeadIds.size > 0 && (
                <span className="text-[10px] text-gray-600 tabular-nums">{savedLeadIds.size}</span>
              )}
            </button>
            <button className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-gray-600 hover:text-gray-400 transition">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/></svg>
              <span className="text-[11px] uppercase tracking-wide">Need help?</span>
            </button>
          </div>
        </nav>

        {/* Bottom: credits + user */}
        <div className="px-4 pb-4 pt-3 border-t border-white/5 shrink-0">
          <div className="bg-[#0a0a0f] border border-white/5 rounded-xl p-3 mb-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5">
                <span className="text-indigo-400 text-[11px]">✦</span>
                <span className="text-[12px] font-medium text-white">Early Access</span>
              </div>
              <span className="text-[10px] text-gray-600">14d left</span>
            </div>
            <div className="w-full h-0.5 bg-gray-800 rounded-full mb-1.5 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{ width: '28%' }} />
            </div>
            <p className="text-[10px] text-gray-600">2.8K / 10K credits</p>
          </div>

          <button onClick={() => setProfileOpen(true)} className="w-full flex items-center justify-between px-1 hover:opacity-80 transition">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center text-xs font-semibold">
                {firstName[0]?.toUpperCase() || 'U'}
              </div>
              <div className="text-left">
                <p className="text-[12px] font-medium text-white leading-tight">{firstName || 'User'}</p>
                <p className="text-[10px] text-gray-500 leading-tight">Early Access</p>
              </div>
            </div>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="gray" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>

      </aside>
    </>
  )
}
