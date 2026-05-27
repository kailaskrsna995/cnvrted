'use client'

export function Sidebar({
  mobileNavOpen,
  setMobileNavOpen,
  category,
  setCategory,
  firstName,
  setProfileOpen
}: {
  mobileNavOpen: boolean
  setMobileNavOpen: (open: boolean) => void
  category: string
  setCategory: (cat: string) => void
  firstName: string
  setProfileOpen: (open: boolean) => void
}) {
  return (
    <>
      {mobileNavOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden backdrop-blur-sm transition-opacity"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside className={`fixed md:relative z-50 w-[240px] border-r border-white/5 flex flex-col h-screen shrink-0 bg-[#050508] transition-transform duration-300 ease-in-out ${mobileNavOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}>
        <div className="px-6 py-8 flex flex-col items-center justify-center gap-2 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="font-bold tracking-[0.3em] text-sm uppercase text-white">cnvrted</span>
            <span className="text-[9px] text-white/40 border border-white/20 px-1.5 py-0.5 rounded uppercase tracking-widest font-semibold leading-none">beta</span>
          </div>
        </div>

        <nav className="flex-1 px-4 flex flex-col gap-1 overflow-hidden mt-4">
          <button className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${category === 'All' ? 'bg-[#181820] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`} onClick={() => setCategory('All')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            <span className="text-[13px] font-medium">Leads</span>
          </button>
          <button className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition ${category === 'Saved' ? 'bg-[#181820] text-white' : 'text-gray-400 hover:text-white hover:bg-white/5'}`} onClick={() => setCategory('Saved')}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>
            <span className="text-[13px] font-medium">Saved</span>
          </button>
        </nav>

        <div className="p-4 shrink-0">
          <div className="bg-[#0a0a0f] border border-white/5 rounded-2xl p-4 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-indigo-400">✦</span>
              <span className="text-[13px] font-medium text-white">Early Access</span>
            </div>
            <p className="text-[10px] text-gray-500 mb-3">Resets in 14 days</p>
            <div className="w-full h-1 bg-gray-800 rounded-full mb-2 overflow-hidden">
              <div className="h-full bg-indigo-500 rounded-full" style={{width: '28%'}}></div>
            </div>
            <p className="text-[10px] text-gray-500">2.8K / 10K credits</p>
          </div>

          <button onClick={() => setProfileOpen(true)} className="w-full flex items-center justify-between px-2 hover:opacity-80 transition">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-gray-800 text-white flex items-center justify-center text-xs font-medium">
                {firstName[0]?.toUpperCase() || 'U'}
              </div>
              <div className="text-left">
                <p className="text-[13px] font-medium text-white leading-tight">{firstName || 'User'}</p>
                <p className="text-[11px] text-gray-500 leading-tight">Early Access</p>
              </div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="gray" strokeWidth="2"><path d="m6 9 6 6 6-6"/></svg>
          </button>
        </div>
      </aside>
    </>
  )
}
