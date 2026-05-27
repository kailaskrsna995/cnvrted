'use client'

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
const API = process.env.NEXT_PUBLIC_API_URL

const GTM_OPTIONS = ['Outbound (cold email/LinkedIn)', 'Inbound (content, SEO)', 'Product-led growth', 'Paid ads', 'Partnerships & referrals', 'Community-led', 'Events & conferences', 'Other']
const ACQUISITION_OPTIONS = ['Cold outreach', 'Organic content', 'Paid acquisition', 'Word of mouth', 'Marketplace/directory listings', 'Inbound demo requests', 'Other']
const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–1000', '1000+']
const SALES_CYCLES = ['Less than 2 weeks', '2–4 weeks', '1–3 months', '3–6 months', '6+ months']
const DEAL_SIZES = ['Under $1K', '$1K – $5K', '$5K – $25K', '$25K – $100K', '$100K+']

type OA = {
  companyName: string; email: string; phone: string; companyDo: string; companySize: string
  icp: string; icpChanged: boolean | null; icpChangedHow: string; gtmMotions: string[]; gtmOtherText: string
  acquisition: string[]; acquisitionOtherText: string; salesCycle: string; competitors: string
  sameContact: boolean; contactName: string; contactRole: string; contactEmail: string
  dealSize: string; bestCustomers: string; includeNews: boolean
}

export function OnboardingQuestionnaire({ userId, onComplete }: {
  userId: string
  onComplete: (serviceOffering: string, industries: string[]) => void
}) {
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const TOTAL_PAGES = 4

  const [a, setA] = useState<OA>({
    companyName: '', email: '', phone: '', companyDo: '', companySize: '',
    icp: '', icpChanged: null, icpChangedHow: '', gtmMotions: [], gtmOtherText: '',
    acquisition: [], acquisitionOtherText: '', salesCycle: '', competitors: '',
    sameContact: true, contactName: '', contactRole: '', contactEmail: '',
    dealSize: '', bestCustomers: '', includeNews: true,
  })

  const set = (f: keyof OA, v: OA[keyof OA]) => setA(p => ({ ...p, [f]: v }))
  const toggleArr = (f: 'gtmMotions' | 'acquisition', v: string) =>
    setA(p => ({ ...p, [f]: (p[f] as string[]).includes(v) ? (p[f] as string[]).filter(x => x !== v) : [...(p[f] as string[]), v] }))

  const answered = [
    a.companyName.trim(), a.email.trim(), a.companyDo.trim(), a.companySize,
    a.icp.trim(), a.icpChanged !== null ? 'y' : '',
    a.gtmMotions.length ? 'y' : '', a.acquisition.length ? 'y' : '',
    a.salesCycle, a.competitors.trim(),
    a.sameContact || a.contactEmail.trim() ? 'y' : '',
    a.dealSize || 'opt', a.bestCustomers || 'opt', 'news',
  ].filter(Boolean).length

  const validate = () => {
    const e: string[] = []
    if (page === 1) {
      if (!a.companyName.trim()) e.push('Company name is required')
      if (!a.email.trim()) e.push('Email is required')
      if (!a.companyDo.trim()) e.push('Tell us what your company does')
      if (!a.companySize) e.push('Company size is required')
    }
    if (page === 2) {
      if (!a.icp.trim()) e.push('ICP description is required')
      if (a.icpChanged === null) e.push('Please answer whether your ICP has changed')
      if (a.icpChanged && !a.icpChangedHow.trim()) e.push('Please describe how your ICP changed')
      if (!a.gtmMotions.length) e.push('Select at least one go-to-market motion')
    }
    if (page === 3) {
      if (!a.acquisition.length) e.push('Select at least one acquisition channel')
      if (!a.salesCycle) e.push('Sales cycle length is required')
      if (!a.competitors.trim()) e.push('Competitors are required')
      if (!a.sameContact && !a.contactEmail.trim()) e.push('Contact email is required')
    }
    setErrors(e)
    return e.length === 0
  }

  const next = () => { if (!validate()) return; setErrors([]); setPage(p => p + 1); window.scrollTo(0, 0) }
  const back = () => { setErrors([]); setPage(p => p - 1) }

  const submit = async () => {
    if (!validate()) return
    setLoading(true)
    try {
      await fetch(`${API}/users/${userId}/preferences/`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          service_offering: a.companyDo.trim(),
          target_industries: [a.icp.trim()],
          company_size: a.companySize,
          company_name: a.companyName.trim(),
          contact_email: a.email.trim(),
          contact_phone: a.phone.trim(),
          icp: a.icp.trim(),
          icp_changed: a.icpChanged,
          icp_changed_how: a.icpChangedHow.trim(),
          gtm_motions: a.gtmMotions,
          gtm_other: a.gtmOtherText.trim(),
          acquisition_channels: a.acquisition,
          acquisition_other: a.acquisitionOtherText.trim(),
          sales_cycle: a.salesCycle,
          competitors: a.competitors.trim(),
          same_contact: a.sameContact,
          contact_name: a.contactName.trim(),
          contact_role: a.contactRole.trim(),
          leads_contact_email: a.contactEmail.trim(),
          deal_size: a.dealSize,
          best_customers: a.bestCustomers.trim(),
          include_news: a.includeNews,
        })
      })
    } catch {}
    if (userId === 'local-test-id') localStorage.setItem('cnvrted_local_prefs', 'true')
    onComplete(a.companyDo.trim(), [a.icp.trim()])
    setLoading(false)
  }

  const iCls = 'w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-white text-[13px] placeholder:text-gray-600 focus:border-indigo-500/50 outline-none transition-colors'
  const lCls = 'block text-[13px] text-white/90 mb-2 font-medium'

  const CustomSelect = ({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: string[]; placeholder: string }) => {
    const [open, setOpen] = useState(false)
    return (
      <div className="relative">
        <button type="button" onClick={() => setOpen(o => !o)}
          className="w-full bg-[#0a0a0f] border border-white/5 rounded-xl px-4 py-3.5 text-[13px] outline-none flex items-center justify-between transition hover:border-white/10"
          style={{ color: value ? '#ffffff' : '#4b5563' }}>
          <span>{value || placeholder}</span>
          <span className="text-gray-500 text-xs ml-2">▼</span>
        </button>
        {open && (
          <div className="absolute z-50 w-full mt-2 border border-white/5 rounded-xl bg-[#0a0a0f] overflow-hidden shadow-2xl backdrop-blur-xl">
            {options.map(opt => (
              <button key={opt} type="button" onClick={() => { onChange(opt); setOpen(false) }}
                className={`w-full text-left text-[13px] px-4 py-3 transition hover:bg-white/5 ${value === opt ? 'bg-indigo-500/10 text-indigo-300' : 'text-gray-300'}`}>
                {opt}
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  const Chips = ({ opts, sel, onToggle, other, setOther }: { opts: string[]; sel: string[]; onToggle: (v: string) => void; other?: string; setOther?: (v: string) => void }) => (
    <div>
      <div className="flex flex-wrap gap-2">
        {opts.map(o => (
          <button key={o} type="button" onClick={() => onToggle(o)}
            className={`text-[12px] font-medium px-4 py-2 rounded-full border transition ${sel.includes(o) ? 'bg-indigo-500/20 text-indigo-300 border-indigo-500/50' : 'bg-[#0a0a0f] text-gray-400 border-white/5 hover:border-white/20'}`}>
            {o}
          </button>
        ))}
      </div>
      {sel.includes('Other') && setOther && (
        <input type="text" value={other || ''} onChange={e => setOther(e.target.value)} placeholder="Please specify..." className={iCls + ' mt-3'} />
      )}
    </div>
  )

  const stepTitles = ['Company Info', 'ICP & Targeting', 'Sales Process', 'Optional Details']
  const motives = ["Let's understand your business first.", 'This helps us find your exact buyers.', 'Stay with us — almost there.', 'Last step — completely optional but super helpful.']

  return (
    <div className="min-h-screen bg-[#030308] relative overflow-hidden flex items-center justify-center p-8 font-sans">
      <video src="/bg-video.mp4" className="absolute inset-0 w-full h-full object-cover opacity-70 mix-blend-screen pointer-events-none z-0" autoPlay loop muted playsInline />
      <div className="absolute top-0 right-0 w-[1000px] h-[800px] bg-indigo-600/10 rounded-full blur-[150px] -translate-y-1/2 translate-x-1/3 pointer-events-none" />
      <div className="absolute bottom-0 left-0 w-[800px] h-[800px] bg-blue-600/10 rounded-full blur-[150px] translate-y-1/3 -translate-x-1/4 pointer-events-none" />

      <div className="w-full max-w-2xl border border-white/5 rounded-[24px] bg-[#07070a]/40 backdrop-blur-2xl relative shadow-[0_0_80px_rgba(0,0,0,0.5)] z-10 overflow-hidden">
        <div className="w-full p-12 md:p-14 flex flex-col justify-center relative max-h-[85vh]">
          <div className="w-full overflow-y-auto pr-4 custom-scrollbar" style={{ scrollbarWidth: 'thin' }}>

            <div className="flex flex-col items-center justify-center mb-10 mt-2">
              <img src="/logo.png" alt="Logo" className="w-[100px] h-auto object-contain mix-blend-screen mb-2" />
              <div className="flex items-center gap-2">
                <span className="text-white font-bold tracking-[0.25em] text-xs uppercase">cnvrted</span>
                <span className="text-[9px] text-white/50 border border-white/20 px-1.5 py-0.5 rounded uppercase tracking-widest font-semibold">BETA</span>
              </div>
            </div>

            <div className="flex items-center justify-between mb-8 sticky top-0 bg-[#07070a]/80 backdrop-blur-md pb-4 z-20 pt-2 border-b border-white/5">
              <div className="flex items-center gap-4 w-64">
                <span className="text-[10px] font-bold tracking-widest text-gray-500 uppercase shrink-0">STEP {page} OF 4</span>
                <div className="flex-1 h-1.5 bg-white/5 rounded-full overflow-hidden flex">
                  <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.5)] transition-all duration-300" style={{ width: `${(page / 4) * 100}%` }} />
                </div>
              </div>
              <span className="text-[12px] text-gray-500">{answered} / 14 answered</span>
            </div>

            <h1 className="text-4xl text-white font-medium mb-3 tracking-tight">{motives[page - 1]}</h1>
            <p className="text-gray-400 text-[15px] mb-10">{stepTitles[page - 1]} — We'll get you the best leads.</p>

            {errors.length > 0 && (
              <div className="mb-6 border border-red-500/30 bg-red-500/10 px-4 py-3 flex flex-col gap-1 rounded-xl">
                {errors.map(e => <p key={e} className="text-[13px] font-medium text-red-400">{e}</p>)}
              </div>
            )}

            <AnimatePresence mode="wait">
              <motion.div key={page} initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="flex flex-col gap-8 pb-4">

                {page === 1 && <>
                  <div><label className={lCls}>Q1 — Company Name <span className="text-red-400">*</span></label><input type="text" value={a.companyName} onChange={e => set('companyName', e.target.value)} placeholder="e.g. Acme Inc." autoFocus className={iCls} /></div>
                  <div><label className={lCls}>Q2 — Your Contact <span className="text-red-400">*</span></label><div className="flex gap-3"><input type="email" value={a.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" className={iCls} /><input type="tel" value={a.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210 (optional)" className={iCls} /></div></div>
                  <div><label className={lCls}>Q3 — What does your company do? <span className="text-red-400">*</span></label><input type="text" value={a.companyDo} onChange={e => set('companyDo', e.target.value)} placeholder="e.g. We help D2C brands automate their email marketing" className={iCls} /></div>
                  <div><label className={lCls}>Q4 — Company Size <span className="text-red-400">*</span></label><CustomSelect value={a.companySize} onChange={v => set('companySize', v)} options={COMPANY_SIZES} placeholder="Select size..." /></div>
                </>}

                {page === 2 && <>
                  <div><label className={lCls}>Q5 — Who is your Ideal Customer Profile (ICP)? <span className="text-red-400">*</span></label><textarea value={a.icp} onChange={e => set('icp', e.target.value)} placeholder="e.g. VP of Marketing at B2B SaaS companies, 50–200 employees, US-based, using HubSpot" className={iCls + ' resize-none'} rows={3} /></div>
                  <div>
                    <label className={lCls}>Q6 — Has your ICP changed in the last 6–12 months? <span className="text-red-400">*</span></label>
                    <div className="flex gap-3 mb-0">{['Yes', 'No'].map(o => (<button key={o} type="button" onClick={() => set('icpChanged', o === 'Yes')} className={`font-mono-custom text-xs px-6 py-2 border transition uppercase tracking-wide ${(o === 'Yes' ? a.icpChanged === true : a.icpChanged === false) ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/20 hover:border-white/60'}`}>{o}</button>))}</div>
                    {a.icpChanged === true && <div className="mt-4"><label className={lCls}>Q6a — How did it change? <span className="text-red-400">*</span></label><textarea value={a.icpChangedHow} onChange={e => set('icpChangedHow', e.target.value)} placeholder="e.g. We shifted from targeting SMBs to mid-market" className={iCls + ' resize-none'} rows={2} /></div>}
                  </div>
                  <div><label className={lCls}>Q7 — Current go-to-market motions <span className="text-red-400">*</span></label><Chips opts={GTM_OPTIONS} sel={a.gtmMotions} onToggle={v => toggleArr('gtmMotions', v)} other={a.gtmOtherText} setOther={v => set('gtmOtherText', v)} /></div>
                </>}

                {page === 3 && <>
                  <div><label className={lCls}>Q8 — How do you currently acquire customers? <span className="text-red-400">*</span></label><Chips opts={ACQUISITION_OPTIONS} sel={a.acquisition} onToggle={v => toggleArr('acquisition', v)} other={a.acquisitionOtherText} setOther={v => set('acquisitionOtherText', v)} /></div>
                  <div><label className={lCls}>Q9 — Typical sales cycle <span className="text-red-400">*</span></label><CustomSelect value={a.salesCycle} onChange={v => set('salesCycle', v)} options={SALES_CYCLES} placeholder="Select sales cycle..." /></div>
                  <div><label className={lCls}>Q10 — Main competitors <span className="text-red-400">*</span></label><input type="text" value={a.competitors} onChange={e => set('competitors', e.target.value)} placeholder="e.g. Apollo.io, Prospeo, Lusha" className={iCls} /></div>
                  <div>
                    <label className={lCls}>Q11 — Point of contact for receiving leads <span className="text-red-400">*</span></label>
                    <label className="flex items-center gap-2 mb-4 cursor-pointer select-none"><input type="checkbox" checked={a.sameContact} onChange={e => set('sameContact', e.target.checked)} className="w-4 h-4 accent-black cursor-pointer" /><span className="font-mono-custom text-xs text-white/60 uppercase tracking-widest">Same as my contact details</span></label>
                    {!a.sameContact && <div className="flex flex-col gap-3"><input type="text" value={a.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Full Name" className={iCls} /><input type="text" value={a.contactRole} onChange={e => set('contactRole', e.target.value)} placeholder="Role" className={iCls} /><input type="email" value={a.contactEmail} onChange={e => set('contactEmail', e.target.value)} placeholder="Email address" className={iCls} /></div>}
                  </div>
                </>}

                {page === 4 && <>
                  <div><label className={lCls}>Q12 — Average deal size <span className="text-white/20 normal-case text-sm font-normal">Optional</span></label><CustomSelect value={a.dealSize} onChange={v => set('dealSize', v)} options={DEAL_SIZES} placeholder="Select deal size..." /></div>
                  <div><label className={lCls}>Q13 — 2–3 best-fit existing customers <span className="text-white/20 normal-case text-sm font-normal">Optional</span></label><input type="text" value={a.bestCustomers} onChange={e => set('bestCustomers', e.target.value)} placeholder="e.g. Freshworks, Razorpay, Postman" className={iCls} /></div>
                  <div>
                    <label className={lCls}>Q14 — Include latest company news in lead enrichment?</label>
                    <div className="flex gap-3">{['Yes', 'No'].map(o => (<button key={o} type="button" onClick={() => set('includeNews', o === 'Yes')} className={`font-mono-custom text-xs px-6 py-2 border transition uppercase tracking-wide ${(o === 'Yes' ? a.includeNews : !a.includeNews) ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/20 hover:border-white/60'}`}>{o}</button>))}</div>
                  </div>
                  <div className="border-l-2 border-white/30 pl-4 py-1">
                    <p className="text-lg text-white">Your feed will be live in minutes.</p>
                    <p className="text-xs text-white/40 uppercase tracking-widest mt-1">Stay with us — we'll get you the best leads.</p>
                  </div>
                </>}

              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-between pt-6 border-t border-white/5 mt-4 sticky bottom-0 bg-[#07070a]/90 backdrop-blur-md pb-2 z-20">
              <button onClick={back} disabled={page === 1} className="text-[13px] font-medium text-gray-400 hover:text-white transition disabled:opacity-0 disabled:pointer-events-none">← Back</button>
              {page < TOTAL_PAGES
                ? <button onClick={next} className="flex items-center gap-2 bg-white text-black text-[13px] font-semibold px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors">Next Step</button>
                : <button onClick={submit} disabled={loading} className="flex items-center gap-2 bg-white text-black text-[13px] font-semibold px-6 py-2.5 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50">{loading ? 'Saving...' : 'Build my feed'}{!loading && <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>}</button>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
