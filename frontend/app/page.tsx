'use client'

import { useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const API = process.env.NEXT_PUBLIC_API_URL

type Lead = {
  id: string
  lead_id: string
  author: string
  profession: string
  company: string
  domain: string
  post_text: string
  exact_need: string
  category: string
  intent_score: number
  timeline: string
  source_url: string
  contact_email: string
  contact_phone: string
  contact_linkedin: string
  ingested_at: string
  posted_at: string | null
  platform?: string
  tokens_used?: number
  location?: string
}

type ActiveSearch = { domain: string; keywords: string[] }

type ScanStats = {
  total_scanned: number
  total_rejected: number
  total_saved: number
}

function scoreColor(score: number) {
  if (score >= 80) return 'bg-black text-white'
  if (score >= 60) return 'bg-gray-700 text-white'
  return 'bg-gray-200 text-gray-700'
}

function timelineColor(timeline: string) {
  if (timeline === 'Urgent') return 'text-red-500'
  if (timeline === 'Active') return 'text-amber-500'
  return 'text-gray-400'
}

function formatDate(iso: string) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function isOlderThan24h(iso: string | null): boolean {
  if (!iso) return false
  return (Date.now() - new Date(iso).getTime()) > 24 * 60 * 60 * 1000
}

function formatCountdown(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)
  const weeks = Math.floor(days / 7)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m`
  if (hours < 24) return `${hours}h`
  if (days < 7) return `${days}d`
  if (weeks < 5) return `${weeks}w`
  return formatDate(iso)
}

// ── Onboarding Questionnaire ──────────────────────────────────────────────────

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

function OnboardingQuestionnaire({ userId, onComplete }: {
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
    onComplete(a.companyDo.trim(), [a.icp.trim()])
    setLoading(false)
  }

  const iCls = 'font-mono-custom w-full border border-white/20 bg-white/[0.06] text-white placeholder:text-white/20 px-3 py-2.5 text-sm outline-none focus:border-white/50 transition'
  const lCls = 'font-mono-custom text-xs text-white/40 uppercase tracking-widest block mb-2'

  const Chips = ({ opts, sel, onToggle, other, setOther }: { opts: string[]; sel: string[]; onToggle: (v: string) => void; other?: string; setOther?: (v: string) => void }) => (
    <div>
      <div className="flex flex-wrap gap-2">
        {opts.map(o => (
          <button key={o} type="button" onClick={() => onToggle(o)}
            className={`font-mono-custom text-xs px-3 py-1.5 border transition uppercase tracking-wide ${sel.includes(o) ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/20 hover:border-white/60'}`}>
            {o}
          </button>
        ))}
      </div>
      {sel.includes('Other') && setOther && (
        <input type="text" value={other || ''} onChange={e => setOther(e.target.value)} placeholder="Please specify..." className={iCls + ' mt-2'} />
      )}
    </div>
  )

  const stepTitles = ['Company Info', 'ICP & Targeting', 'Sales Process', 'Optional Details']
  const motives = ['Let\'s understand your business first.', 'This helps us find your exact buyers.', 'Stay with us — almost there.', 'Last step — completely optional but super helpful.']

  return (
    <div className="min-h-screen bg-black flex flex-col">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-black border-b border-white/10 px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-white">cnvrted</span>
          <span className="font-mono-custom text-[10px] text-white/30 border border-white/20 px-1.5 py-0.5 uppercase tracking-widest leading-none">beta</span>
        </div>
        <div className="flex items-center gap-6">
          <span className="font-mono-custom text-xs text-white/40">{answered} / 14 answered</span>
          <div className="flex items-center gap-1.5">
            {[1,2,3,4].map(i => (
              <div key={i} className={`h-1 rounded-full transition-all duration-300 ${i <= page ? 'bg-white' : 'bg-white/20'} ${i === page ? 'w-8' : 'w-3'}`} />
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-6 py-12 w-full">
        <p className="font-mono-custom text-xs text-white/40 uppercase tracking-widest mb-2">Step {page} of {TOTAL_PAGES} — {stepTitles[page-1]}</p>
        <h1 className="font-canela text-4xl font-light text-white mb-2">{motives[page-1]}</h1>
        <p className="font-mono-custom text-xs text-white/20 uppercase tracking-widest mb-10">Stay with us — we'll get you the best leads.</p>

        {errors.length > 0 && (
          <div className="mb-6 border border-red-500/30 bg-red-500/10 px-4 py-3 flex flex-col gap-1">
            {errors.map(e => <p key={e} className="font-mono-custom text-xs text-red-400 uppercase tracking-widest">{e}</p>)}
          </div>
        )}

        <div className="flex flex-col gap-8">

          {/* ── PAGE 1 ── */}
          {page === 1 && <>
            <div>
              <label className={lCls}>Q1 — Company Name <span className="text-red-400">*</span></label>
              <input type="text" value={a.companyName} onChange={e => set('companyName', e.target.value)} placeholder="e.g. Acme Inc." autoFocus className={iCls} />
            </div>
            <div>
              <label className={lCls}>Q2 — Your Contact <span className="text-red-400">*</span></label>
              <div className="flex gap-3">
                <input type="email" value={a.email} onChange={e => set('email', e.target.value)} placeholder="you@company.com" className={iCls} />
                <input type="tel" value={a.phone} onChange={e => set('phone', e.target.value)} placeholder="+91 98765 43210 (optional)" className={iCls} />
              </div>
            </div>
            <div>
              <label className={lCls}>Q3 — What does your company do? <span className="text-red-400">*</span></label>
              <input type="text" value={a.companyDo} onChange={e => set('companyDo', e.target.value)} placeholder="e.g. We help D2C brands automate their email marketing" className={iCls} />
            </div>
            <div>
              <label className={lCls}>Q4 — Company Size <span className="text-red-400">*</span></label>
              <div className="relative">
                <select value={a.companySize} onChange={e => set('companySize', e.target.value)} className={iCls + ' appearance-none cursor-pointer'}>
                  <option value="">Select size...</option>
                  {COMPANY_SIZES.map(s => <option key={s}>{s}</option>)}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none text-xs">▼</span>
              </div>
            </div>
          </>}

          {/* ── PAGE 2 ── */}
          {page === 2 && <>
            <div>
              <label className={lCls}>Q5 — Who is your Ideal Customer Profile (ICP)? <span className="text-red-400">*</span></label>
              <textarea value={a.icp} onChange={e => set('icp', e.target.value)} placeholder="e.g. VP of Marketing at B2B SaaS companies, 50–200 employees, US-based, using HubSpot" className={iCls + ' resize-none'} rows={3} />
            </div>
            <div>
              <label className={lCls}>Q6 — Has your ICP changed in the last 6–12 months? <span className="text-red-400">*</span></label>
              <div className="flex gap-3 mb-0">
                {['Yes', 'No'].map(o => (
                  <button key={o} type="button" onClick={() => set('icpChanged', o === 'Yes')}
                    className={`font-mono-custom text-xs px-6 py-2 border transition uppercase tracking-wide ${(o === 'Yes' ? a.icpChanged === true : a.icpChanged === false) ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/20 hover:border-white/60'}`}>
                    {o}
                  </button>
                ))}
              </div>
              {a.icpChanged === true && (
                <div className="mt-4">
                  <label className={lCls}>Q6a — How did it change and why? <span className="text-red-400">*</span></label>
                  <textarea value={a.icpChangedHow} onChange={e => set('icpChangedHow', e.target.value)} placeholder="e.g. We shifted from targeting SMBs to mid-market because of higher retention rates" className={iCls + ' resize-none'} rows={2} />
                </div>
              )}
            </div>
            <div>
              <label className={lCls}>Q7 — Current go-to-market motions <span className="text-red-400">*</span></label>
              <Chips opts={GTM_OPTIONS} sel={a.gtmMotions} onToggle={v => toggleArr('gtmMotions', v)} other={a.gtmOtherText} setOther={v => set('gtmOtherText', v)} />
            </div>
          </>}

          {/* ── PAGE 3 ── */}
          {page === 3 && <>
            <div>
              <label className={lCls}>Q8 — How do you currently acquire customers? <span className="text-red-400">*</span></label>
              <Chips opts={ACQUISITION_OPTIONS} sel={a.acquisition} onToggle={v => toggleArr('acquisition', v)} other={a.acquisitionOtherText} setOther={v => set('acquisitionOtherText', v)} />
            </div>
            <div>
              <label className={lCls}>Q9 — Typical sales cycle <span className="text-red-400">*</span></label>
              <div className="relative">
                <select value={a.salesCycle} onChange={e => set('salesCycle', e.target.value)} className={iCls + ' appearance-none cursor-pointer'}>
                  <option value="">Select sales cycle...</option>
                  {SALES_CYCLES.map(s => <option key={s}>{s}</option>)}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none text-xs">▼</span>
              </div>
            </div>
            <div>
              <label className={lCls}>Q10 — Main competitors <span className="text-red-400">*</span></label>
              <input type="text" value={a.competitors} onChange={e => set('competitors', e.target.value)} placeholder="e.g. Apollo.io, Prospeo, Lusha" className={iCls} />
            </div>
            <div>
              <label className={lCls}>Q11 — Point of contact for receiving leads <span className="text-red-400">*</span></label>
              <label className="flex items-center gap-2 mb-4 cursor-pointer select-none">
                <input type="checkbox" checked={a.sameContact} onChange={e => set('sameContact', e.target.checked)} className="w-4 h-4 accent-black cursor-pointer" />
                <span className="font-mono-custom text-xs text-white/60 uppercase tracking-widest">Same as my contact details</span>
              </label>
              {!a.sameContact && (
                <div className="flex flex-col gap-3">
                  <input type="text" value={a.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Full Name" className={iCls} />
                  <input type="text" value={a.contactRole} onChange={e => set('contactRole', e.target.value)} placeholder="Role (e.g. Head of Sales, CEO)" className={iCls} />
                  <input type="email" value={a.contactEmail} onChange={e => set('contactEmail', e.target.value)} placeholder="Email address" className={iCls} />
                </div>
              )}
            </div>
          </>}

          {/* ── PAGE 4 ── */}
          {page === 4 && <>
            <div>
              <label className={lCls}>Q12 — Average deal size <span className="font-canela text-sm text-white/20 normal-case tracking-normal">Optional</span></label>
              <div className="relative">
                <select value={a.dealSize} onChange={e => set('dealSize', e.target.value)} className={iCls + ' appearance-none cursor-pointer'}>
                  <option value="">Select deal size...</option>
                  {DEAL_SIZES.map(s => <option key={s}>{s}</option>)}
                </select>
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 pointer-events-none text-xs">▼</span>
              </div>
            </div>
            <div>
              <label className={lCls}>Q13 — 2–3 best-fit existing customers <span className="font-canela text-sm text-white/20 normal-case tracking-normal">Optional — helps us build lookalike targeting</span></label>
              <input type="text" value={a.bestCustomers} onChange={e => set('bestCustomers', e.target.value)} placeholder="e.g. Freshworks, Razorpay, Postman" className={iCls} />
            </div>
            <div>
              <label className={lCls}>Q14 — Include latest company news in lead enrichment? <span className="text-red-400">*</span></label>
              <div className="flex gap-3">
                {['Yes', 'No'].map(o => (
                  <button key={o} type="button" onClick={() => set('includeNews', o === 'Yes')}
                    className={`font-mono-custom text-xs px-6 py-2 border transition uppercase tracking-wide ${(o === 'Yes' ? a.includeNews : !a.includeNews) ? 'bg-white text-black border-white' : 'bg-transparent text-white/50 border-white/20 hover:border-white/60'}`}>
                    {o}
                  </button>
                ))}
              </div>
            </div>
            <div className="border-l-2 border-white/30 pl-4 py-1">
              <p className="font-canela text-lg text-white">Your feed will be live in minutes.</p>
              <p className="font-mono-custom text-xs text-white/40 uppercase tracking-widest mt-1">Stay with us — we'll get you the best leads.</p>
            </div>
          </>}

          {/* Navigation */}
          <div className="flex items-center justify-between pt-6 border-t border-white/10 mt-2">
            <button onClick={back} disabled={page === 1}
              className="font-mono-custom text-xs text-white/40 uppercase tracking-widest hover:text-white transition disabled:opacity-0 disabled:pointer-events-none">
              ← Back
            </button>
            <div className="flex items-center gap-4">
              <span className="font-mono-custom text-xs text-white/30">{answered} / 14</span>
              {page < TOTAL_PAGES ? (
                <button onClick={next} className="font-mono-custom bg-white text-black text-xs px-6 py-2.5 uppercase tracking-widest hover:bg-white/90 transition">
                  Next →
                </button>
              ) : (
                <button onClick={submit} disabled={loading} className="font-mono-custom bg-white text-black text-xs px-6 py-2.5 uppercase tracking-widest hover:bg-white/90 transition disabled:opacity-40">
                  {loading ? 'Saving...' : 'Build my feed →'}
                </button>
              )}
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}

function PostPreviewModal({ lead, onClose }: { lead: Lead, onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white w-full max-w-2xl mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/10">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 border border-black/20 flex items-center justify-center font-canela text-base font-medium shrink-0">
              {lead.author?.[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-canela text-base font-medium text-black">{lead.author}</p>
              {lead.profession && <p className="font-mono-custom text-xs text-gray-400 mt-0.5">{lead.profession}</p>}
            </div>
          </div>
          <button onClick={onClose} className="font-mono-custom text-xs text-gray-400 hover:text-black transition">✕</button>
        </div>

        <div className="px-6 py-5 max-h-96 overflow-y-auto">
          {lead.exact_need && (
            <div className="border-l-2 border-black pl-3 mb-4">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-1">Looking for</p>
              <p className="font-canela text-base text-black">{lead.exact_need}</p>
            </div>
          )}
          <p className="text-gray-600 text-sm leading-relaxed whitespace-pre-wrap">{lead.post_text}</p>
        </div>

        <div className="px-6 py-4 border-t border-black/10 flex justify-between items-center">
          <span className="font-mono-custom text-xs text-gray-400">{formatDate(lead.posted_at || lead.ingested_at)}</span>
          {lead.source_url ? (
            <a
              href={lead.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono-custom text-xs border border-black bg-black text-white px-4 py-2 hover:bg-gray-900 transition"
            >
              {lead.platform === 'reddit' ? 'Open on Reddit ↗' : lead.platform === 'twitter' ? 'Open on X ↗' : 'Open on LinkedIn ↗'}
            </a>
          ) : (
            <span className="font-mono-custom text-xs text-gray-300">No source URL</span>
          )}
        </div>
      </div>
    </div>
  )
}

const ALLOWED_EMAILS = [
  'kailaskrsna@cnvrted.com',
  'sharan@cnvrted.com',
  'vishnu@cnvrted.com',
  'dhruv@cnvrted.com',
]

function OnboardingScreen({ onComplete }: { onComplete: (userId: string, displayName: string, status: string) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password.trim() || loading) return

    const uname = username.trim().toLowerCase()
    if (!ALLOWED_EMAILS.includes(uname)) {
      setError('Restricted Access.')
      return
    }

    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/users/auth/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: uname,
          name: '',
          profession: '',
          password
        })
      })
      if (res.status === 401) {
        setError('Incorrect password.')
        setLoading(false)
        return
      }
      if (res.status === 403) {
        setError('Only @cnvrted.com emails are allowed.')
        setLoading(false)
        return
      }
      const user = await res.json()
      const displayName = user.name || user.username
      localStorage.setItem('cnvrted_user_id', user.id)
      localStorage.setItem('cnvrted_user_name', displayName)
      localStorage.setItem('cnvrted_username', user.username)
      localStorage.setItem('cnvrted_user_status', user.status || 'pending')
      onComplete(user.id, displayName, user.status || 'pending')
    } catch {
      setError('Something went wrong. Try again.')
      setLoading(false)
    }
  }

  return (
    <div className="h-screen bg-black flex flex-col">

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-10 py-7">
        <div className="flex items-center gap-2.5">
          <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-white">cnvrted</span>
          <span className="font-mono-custom text-[10px] text-white/30 border border-white/20 px-1.5 py-0.5 uppercase tracking-widest leading-none">beta</span>
        </div>
      </div>

      {/* Centered form */}
      <div className="relative z-10 flex-1 flex items-center justify-center px-8">
        <div className="w-full max-w-sm">
          <p className="font-mono-custom text-xs text-white/30 uppercase tracking-widest mb-3">Get started</p>
          <h2 className="font-canela text-4xl font-light text-white mb-10 leading-tight">
            Set up your<br />workspace.
          </h2>
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">

            <div>
              <label className="font-mono-custom text-xs text-white/40 uppercase tracking-widest block mb-2">Work Email</label>
              <input
                type="text" value={username} onChange={e => setUsername(e.target.value)}
                placeholder="e.g. name@cnvrted.com" autoFocus
                className="font-canela text-base w-full border border-white/20 bg-white/[0.06] text-white placeholder:text-white/20 px-4 py-3 outline-none focus:border-white/50 transition-all duration-150"
              />
            </div>

            <div>
              <label className="font-mono-custom text-xs text-white/40 uppercase tracking-widest block mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'} value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Choose a password"
                  className="font-canela text-base w-full border border-white/20 bg-white/[0.06] text-white placeholder:text-white/20 px-4 py-3 pr-10 outline-none focus:border-white/50 transition-all duration-150"
                />
                <button
                  type="button" tabIndex={-1}
                  onClick={() => setShowPassword(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/20 hover:text-white/60 transition-colors duration-150"
                >
                  {showPassword ? (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {error && (
              <p className={`font-mono-custom text-xs uppercase tracking-widest ${error.startsWith('Restricted') ? 'text-red-400 font-bold' : 'text-red-400'}`}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={!username.trim() || !password.trim() || loading}
              className="font-mono-custom mt-1 w-full bg-white text-black text-xs px-3 py-3 uppercase tracking-widest hover:bg-white/90 hover:-translate-y-0.5 transition-all duration-150 disabled:opacity-30 disabled:translate-y-0"
            >
              {loading ? 'Setting up...' : 'Enter →'}
            </button>

            <p className="font-mono-custom text-xs text-white/20 text-center">
              Returning? Enter your email + password to sign back in.
            </p>
          </form>
        </div>
      </div>

      {/* Bottom tagline */}
      <div className="relative z-10 px-10 py-7">
        <p className="font-mono-custom text-xs text-white/15 uppercase tracking-widest">
          Intent signals from LinkedIn & X, scored by AI in real time · Est. 2026
        </p>
      </div>
    </div>
  )
}

function ProfileModal({ userName, userPosition, savedLeadIds, onClose, onLogout }: {
  userName: string
  userPosition: string
  savedLeadIds: Set<string>
  onClose: () => void
  onLogout: () => void
}) {
  const [savedLeads, setSavedLeads] = useState<Lead[]>([])

  useEffect(() => {
    if (savedLeadIds.size === 0) { setSavedLeads([]); return }
    supabase.from('leads').select('*').in('lead_id', [...savedLeadIds]).order('ingested_at', { ascending: false })
      .then(({ data }) => setSavedLeads(data || []))
  }, [savedLeadIds])

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="w-96 bg-white border-l border-black/10 flex flex-col h-full overflow-hidden">
        <div className="px-6 py-5 border-b border-black/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-black flex items-center justify-center font-canela text-white text-base">
              {userName[0]?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="font-canela text-base font-medium text-black leading-tight">{userName}</p>
              <p className="font-mono-custom text-xs text-gray-400 mt-0.5">
                @{typeof window !== 'undefined' ? localStorage.getItem('cnvrted_username') || '' : ''}
                {userPosition ? ` · ${userPosition}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={onLogout}
              className="font-mono-custom text-xs text-red-400 hover:text-red-600 uppercase tracking-widest transition"
            >
              Log out
            </button>
            <button onClick={onClose} className="font-mono-custom text-xs text-gray-400 hover:text-black uppercase tracking-widest transition">✕</button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-5 pb-5 border-b border-black/10">
            <div className="flex justify-between items-center mb-2">
              <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">Credits</p>
              <p className="font-mono-custom text-xs text-gray-400">0 / 100</p>
            </div>
            <div className="w-full h-1 bg-gray-100">
              <div className="h-1 bg-black transition-all" style={{ width: '0%' }} />
            </div>
            <p className="font-mono-custom text-xs text-gray-300 mt-1.5">Payments coming soon</p>
          </div>

          <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest mb-4">
            Saved — {savedLeadIds.size}
          </p>
          {savedLeads.length === 0 ? (
            <p className="font-mono-custom text-xs text-gray-300 uppercase tracking-widest">No saved leads yet</p>
          ) : (
            <div className="flex flex-col gap-3">
              {savedLeads.map(lead => (
                <div key={lead.id} className="border border-black/10 p-4 hover:border-black/30 transition">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <p className="font-canela text-sm font-medium text-black">{lead.author}</p>
                      {lead.profession && <p className="font-mono-custom text-xs text-gray-400 mt-0.5">{lead.profession}</p>}
                    </div>
                    <span className={`font-mono-custom text-xs px-1.5 py-0.5 font-bold shrink-0 ${scoreColor(lead.intent_score)}`}>
                      {lead.intent_score}
                    </span>
                  </div>
                  {lead.exact_need && (
                    <p className="font-canela text-sm text-gray-700 line-clamp-2">{lead.exact_need}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function extractFirstName(nameOrEmail: string): string {
  if (!nameOrEmail) return ''
  if (nameOrEmail.includes('@')) {
    const local = nameOrEmail.split('@')[0]
    const first = local.split(/[._]/)[0]
    return first.charAt(0).toUpperCase() + first.slice(1)
  }
  return nameOrEmail.split(' ')[0]
}

function getGreeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function avatarBg(name: string) {
  const palette = ['bg-blue-100 text-blue-700','bg-emerald-100 text-emerald-700','bg-violet-100 text-violet-700','bg-amber-100 text-amber-700','bg-rose-100 text-rose-700','bg-cyan-100 text-cyan-700']
  return palette[(name?.charCodeAt(0) || 0) % palette.length]
}

export default function Dashboard() {
  const [userId, setUserId] = useState<string | null>(null)
  const [userName, setUserName] = useState('')
  const [userPosition, setUserPosition] = useState('')
  const [ready, setReady] = useState(false)
  const [leads, setLeads] = useState<Lead[]>([])
  const [category, setCategory] = useState('All')
  const [stats, setStats] = useState<Record<string, number>>({})
  const [savedLeadIds, setSavedLeadIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [scanStats, setScanStats] = useState<ScanStats>({ total_scanned: 0, total_rejected: 0, total_saved: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [activeSearch, setActiveSearch] = useState<ActiveSearch | null>(null)
  const [cooldownRemaining, setCooldownRemaining] = useState(0)
  const [profileOpen, setProfileOpen] = useState(false)
  const [preferencesSet, setPreferencesSet] = useState<boolean | null>(null)
  const [suggestedDomains, setSuggestedDomains] = useState<string[]>([])
  const [previewLead, setPreviewLead] = useState<Lead | null>(null)
  const [revealedEmails, setRevealedEmails] = useState<Set<string>>(new Set())
  const [revealedPhones, setRevealedPhones] = useState<Set<string>>(new Set())
  const toggleEmail = (id: string) => setRevealedEmails(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const togglePhone = (id: string) => setRevealedPhones(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })
  const scanPollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  type ChatMsg = { role: 'user' | 'ai'; text: string; scanParams?: { domain: string; keywords: string[] } }
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const chatEndRef = useRef<HTMLDivElement>(null)
  const [allLeadStats, setAllLeadStats] = useState({ total: 0, qualified: 0, urgent: 0, linkedin: 0, twitter: 0 })

  // Cleanup poll on unmount
  useEffect(() => {
    return () => { if (scanPollRef.current) clearInterval(scanPollRef.current) }
  }, [])

  useEffect(() => {
    const id = localStorage.getItem('cnvrted_user_id')
    const name = localStorage.getItem('cnvrted_user_name')
    if (id) {
      setUserId(id)
      if (name) setUserName(name)
      fetchUser(id)
      fetchSaved(id)
    }
    setReady(true)
  }, [])

  // On mount, check if scan is already running (e.g. page refresh mid-scan)
  useEffect(() => {
    if (!ready) return
    fetch(`${API}/ingest/status/`)
      .then(r => r.json())
      .then(data => {
        setScanStats({ total_scanned: data.total_scanned, total_rejected: data.total_rejected, total_saved: data.total_saved })
        if (data.scanning) {
          setScanning(true)
          startPolling()
        }
      })
      .catch(() => {})
  }, [ready])

  useEffect(() => {
    if (cooldownRemaining <= 0) return
    const timer = setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) { clearInterval(timer); return 0 }
        return prev - 1
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [cooldownRemaining])

  // Only fetch leads after ready + userId resolved — prevents showing other users' leads
  useEffect(() => {
    if (!ready) return
    fetchLeads(category, userId)
    fetchStats(userId)
  }, [category, userId, ready])

  useEffect(() => {
    if (category === 'Saved') fetchLeads('Saved', userId)
  }, [savedLeadIds])

  useEffect(() => {
    const channel = supabase.channel('leads-realtime')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'leads' }, () => {
        fetchLeads(category, userId)
        fetchStats(userId)
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [category, userId])

  const startPolling = () => {
    if (scanPollRef.current) clearInterval(scanPollRef.current)
    scanPollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API}/ingest/status/`)
        const data = await res.json()
        setScanStats({ total_scanned: data.total_scanned, total_rejected: data.total_rejected, total_saved: data.total_saved })
        if (!data.scanning) {
          setScanning(false)
          clearInterval(scanPollRef.current!)
          scanPollRef.current = null
          // Refresh leads after scan finishes
          fetchLeads(category, userId)
          fetchStats(userId)
        }
      } catch {}
    }, 3000)
  }

  const fetchUser = async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/`)
      if (res.status === 404) {
        // User doesn't exist in this DB — stale localStorage, force re-login
        localStorage.clear()
        setUserId(null)
        setUserName('')
        setPreferencesSet(null)
        return
      }
      if (!res.ok) return
      const data = await res.json()
      const displayName = data.name || data.username || ''
      setUserName(displayName)
      setUserPosition(data.profession || '')
      localStorage.setItem('cnvrted_user_name', displayName)
      if (data.username) localStorage.setItem('cnvrted_username', data.username)
      // TODO: re-enable 30-min cooldown before production deploy
      // if (data.last_scanned_at) {
      //   const elapsed = (Date.now() - new Date(data.last_scanned_at).getTime()) / 1000
      //   const remaining = Math.max(0, 1800 - elapsed)
      //   setCooldownRemaining(Math.floor(remaining))
      // }
      
      const hasPrefs = !!(data.service_offering?.trim())
      setPreferencesSet(hasPrefs)
      if (hasPrefs) {
        const suggestions = [data.service_offering, ...(data.target_industries || [])].filter(Boolean)
        setSuggestedDomains(suggestions.slice(0, 5))
      }
    } catch {}
  }

  const fetchSaved = async (id: string) => {
    try {
      const res = await fetch(`${API}/users/${id}/saves/`)
      if (!res.ok) return
      const data: string[] = await res.json()
      setSavedLeadIds(new Set(data))
    } catch {}
  }

  const fetchLeads = async (cat: string, uid: string | null) => {
    if (cat === 'Saved') {
      if (savedLeadIds.size === 0) { setLeads([]); return }
      const { data } = await supabase.from('leads').select('*').in('lead_id', [...savedLeadIds]).order('ingested_at', { ascending: false })
      setLeads(data || [])
      return
    }
    let query = supabase.from('leads').select('*').eq('qualified', true).order('ingested_at', { ascending: false }).limit(50)
    if (uid) query = query.eq('user_id', uid)
    if (cat !== 'All') query = query.eq('category', cat)
    const { data } = await query
    setLeads(data || [])
  }

  const fetchStats = async (uid: string | null) => {
    let query = supabase.from('leads').select('category, timeline, platform').eq('qualified', true)
    if (uid) query = query.eq('user_id', uid)
    const { data } = await query
    const counts: Record<string, number> = {}
    let urgent = 0, linkedin = 0, twitter = 0
    data?.forEach(r => {
      counts[r.category] = (counts[r.category] || 0) + 1
      if (r.timeline === 'Urgent') urgent++
      if (r.platform === 'linkedin') linkedin++
      if (r.platform === 'twitter') twitter++
    })
    setStats(counts)
    setAllLeadStats({ total: data?.length || 0, qualified: data?.length || 0, urgent, linkedin, twitter })
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!searchQuery.trim() || searchLoading) return
    setSearchLoading(true)
    try {
      const res = await fetch(`${API}/search/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw_query: searchQuery.trim() })
      })
      const data = await res.json()
      setActiveSearch(data)
    } catch {}
    setSearchLoading(false)
  }

  const sendChat = async () => {
    if (!searchQuery.trim() || chatLoading) return
    const userMsg = searchQuery.trim()
    setSearchQuery('')
    setChatMessages(prev => [...prev, { role: 'user', text: userMsg }])
    setChatLoading(true)
    try {
      const res = await fetch(`${API}/chat/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId, message: userMsg })
      })
      const data = await res.json()
      setChatMessages(prev => [...prev, {
        role: 'ai',
        text: `Found ${data.keywords?.length || 0} keywords for "${data.domain}"`,
        scanParams: { domain: data.domain, keywords: data.keywords || [] }
      }])
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
    } catch {
      setChatMessages(prev => [...prev, { role: 'ai', text: 'Something went wrong. Try again.' }])
    }
    setChatLoading(false)
  }

  const triggerIngest = async (params?: { keywords: string[]; domain: string }) => {
    if (cooldownRemaining > 0 || loading || scanning) return

    setLoading(true)
    try {
      const body: Record<string, unknown> = {}
      if (userId) body.user_id = userId
      if (params) {
        body.keywords = params.keywords
        body.domain = params.domain
      }

      const res = await fetch(`${API}/ingest/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      const data = await res.json()
      if (data.status === 'Scan started in background') {
        setScanning(true)
        startPolling()
      }
      // TODO: re-enable 30-min cooldown before production deploy
    } catch {}
    setLoading(false)
  }

  const toggleSave = async (lead: Lead) => {
    if (!userId) return
    const isSaved = savedLeadIds.has(lead.lead_id)
    setSavedLeadIds(prev => {
      const s = new Set(prev)
      isSaved ? s.delete(lead.lead_id) : s.add(lead.lead_id)
      return s
    })
    try {
      await fetch(`${API}/users/${userId}/saves/${lead.lead_id}/`, {
        method: isSaved ? 'DELETE' : 'POST'
      })
    } catch {
      setSavedLeadIds(prev => {
        const s = new Set(prev)
        isSaved ? s.add(lead.lead_id) : s.delete(lead.lead_id)
        return s
      })
    }
  }


  if (!ready) return null
  if (!userId) {
    return <OnboardingScreen onComplete={(id, name) => { setUserId(id); setUserName(name); fetchSaved(id); setPreferencesSet(false) }} />
  }



  if (preferencesSet === null) return null
  if (!preferencesSet) {
    return (
      <OnboardingQuestionnaire
        userId={userId}
        onComplete={async (serviceOffering, industries) => {
          setPreferencesSet(true)
          const suggestions = [serviceOffering, ...industries].filter(Boolean)
          setSuggestedDomains(suggestions.slice(0, 5))
          // Pre-resolve service offering through LLM keyword generator
          try {
            const res = await fetch(`${API}/search/`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ raw_query: serviceOffering })
            })
            const data = await res.json()
            setActiveSearch(data)
            setSearchQuery(serviceOffering)
          } catch {}
        }}
      />
    )
  }

  const categoryKeys = Object.keys(stats).filter(k => k && k !== 'None')
  const hotCount = allLeadStats.urgent
  const firstName = extractFirstName(userName)

  return (
    <div className="h-screen flex bg-gray-50 overflow-hidden">
      {profileOpen && (
        <ProfileModal
          userName={userName}
          userPosition={userPosition}
          savedLeadIds={savedLeadIds}
          onClose={() => setProfileOpen(false)}
          onLogout={() => {
            localStorage.clear()
            setUserId(null)
            setUserName('')
            setProfileOpen(false)
            setPreferencesSet(null)
            setLeads([])
          }}
        />
      )}
      {previewLead && (
        <PostPreviewModal lead={previewLead} onClose={() => setPreviewLead(null)} />
      )}

      {/* ── LEFT SIDEBAR ── */}
      <aside className="w-64 bg-white border-r border-gray-100 flex flex-col h-screen shrink-0">
        <div className="px-5 py-5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="font-mono-custom text-sm font-bold tracking-widest uppercase text-black">cnvrted</span>
            <span className="font-mono-custom text-[9px] text-gray-300 border border-black/10 px-1.5 py-0.5 uppercase tracking-widest leading-none">beta</span>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 flex flex-col overflow-hidden">
          <button onClick={() => setCategory('All')}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition mb-1 shrink-0 ${category === 'All' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span className="font-mono-custom text-xs uppercase tracking-wide">Overview</span>
          </button>

          {categoryKeys.length > 0 && <p className="font-mono-custom text-[10px] text-gray-300 uppercase tracking-widest px-3 mb-1.5 mt-3 shrink-0">Categories</p>}
          <div className="flex-1 overflow-hidden flex flex-col gap-0.5">
            {categoryKeys.map(cat => (
              <button key={cat} onClick={() => setCategory(cat)}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-lg transition shrink-0 ${category === cat ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                <span className="font-mono-custom text-xs uppercase tracking-wide truncate text-left flex-1 min-w-0 mr-2">{cat}</span>
                <span className={`font-mono-custom text-[10px] px-1.5 py-0.5 rounded shrink-0 ${category === cat ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>{stats[cat] || 0}</span>
              </button>
            ))}
          </div>

          <div className="pt-3 border-t border-gray-100 mt-3 shrink-0">
            <button onClick={() => setCategory('Saved')}
              className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg transition ${category === 'Saved' ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                <svg width="14" height="14" viewBox="0 0 24 24" fill={category === 'Saved' ? 'white' : 'none'} stroke="currentColor" strokeWidth="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
                <span className="font-mono-custom text-xs uppercase tracking-wide">Saved</span>
              </div>
              {savedLeadIds.size > 0 && <span className={`font-mono-custom text-[10px] px-1.5 py-0.5 rounded ${category === 'Saved' ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-400'}`}>{savedLeadIds.size}</span>}
            </button>
          </div>
        </nav>

        <div className="px-4 py-4 border-t border-gray-100 shrink-0">
          <button className="flex items-center gap-2 text-gray-400 hover:text-gray-600 transition">
            <div className="w-5 h-5 rounded-full border border-gray-200 flex items-center justify-center font-mono-custom text-[10px]">?</div>
            <span className="font-mono-custom text-xs uppercase tracking-wide">Need help?</span>
          </button>
        </div>
      </aside>

      {/* ── CENTER ── */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        <div className="flex items-center justify-between px-8 py-4 bg-white border-b border-gray-100 shrink-0">
          <h1 className="font-canela text-xl font-medium text-black">
            {category === 'All' ? 'Overview' : category === 'Saved' ? 'Saved Leads' : category}
          </h1>
          <div className="flex items-center gap-4">
            {scanning && (
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/>
                <span className="font-mono-custom text-xs text-amber-500 uppercase tracking-widest">Scanning</span>
              </div>
            )}
            <button onClick={() => setProfileOpen(true)} className="flex items-center gap-2.5 hover:opacity-80 transition">
              <div className="w-8 h-8 rounded-full bg-black flex items-center justify-center font-canela text-white text-xs shrink-0">
                {firstName[0]?.toUpperCase() || '?'}
              </div>
              <div className="text-left">
                <p className="font-canela text-sm font-medium text-black leading-tight">{firstName}</p>
                <p className="font-mono-custom text-[10px] text-gray-400 leading-tight">Pro Plan</p>
              </div>
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-8 py-8">
          {/* Greeting */}
          <div className="text-center mb-8">
            <div className="flex items-center gap-2 justify-center mb-5">
              <span className="font-mono-custom text-2xl font-bold tracking-widest uppercase text-black">cnvrted</span>
              <span className="font-mono-custom text-[10px] text-gray-300 border border-black/10 px-1.5 py-0.5 uppercase tracking-widest leading-none">beta</span>
            </div>
            <h2 className="font-canela text-3xl font-light text-black mb-2">
              {getGreeting()}, {firstName}
            </h2>
            <p className="font-mono-custom text-xs text-gray-400 uppercase tracking-widest">
              Your AI sales rep that finds buyers before they find you
            </p>
          </div>

          {/* Stat cards — no graphs */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Leads', value: allLeadStats.total, sub: 'all time' },
              { label: 'Qualified', value: allLeadStats.qualified, sub: 'score ≥ 60' },
              { label: 'Urgent', value: allLeadStats.urgent, sub: 'need reply now' },
              { label: 'Posts Scanned', value: scanStats.total_scanned, sub: `${scanStats.total_rejected} rejected` },
            ].map(card => (
              <div key={card.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
                <p className="font-mono-custom text-[10px] text-gray-400 uppercase tracking-widest mb-2">{card.label}</p>
                <p className="font-canela text-3xl font-light text-black leading-none mb-1">{card.value}</p>
                <p className="font-mono-custom text-[10px] text-gray-400 mt-3">{card.sub}</p>
              </div>
            ))}
          </div>

          {/* Leads by source + top industries */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <p className="font-mono-custom text-[10px] text-gray-400 uppercase tracking-widest mb-4">Leads by Source</p>
              {allLeadStats.total > 0 ? (
                <div className="flex flex-col gap-2">
                  {[
                    { label: 'LinkedIn', count: allLeadStats.linkedin, color: 'bg-blue-500' },
                    { label: 'X / Twitter', count: allLeadStats.twitter, color: 'bg-black' },
                  ].map(s => (
                    <div key={s.label} className="flex items-center gap-3">
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-mono-custom text-xs text-gray-600">{s.label}</span>
                          <span className="font-mono-custom text-xs text-gray-400">{Math.round((s.count / allLeadStats.total) * 100)}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className={`h-full ${s.color} rounded-full`} style={{ width: `${Math.round((s.count / allLeadStats.total) * 100)}%` }}/>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono-custom text-xs text-gray-300">No data yet</p>
              )}
            </div>
            <div className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <p className="font-mono-custom text-[10px] text-gray-400 uppercase tracking-widest mb-4">Top Industries</p>
              {categoryKeys.length > 0 ? (
                <div className="flex flex-col gap-2">
                  {categoryKeys.slice(0, 4).map(cat => (
                    <div key={cat} className="flex items-center justify-between">
                      <span className="font-mono-custom text-xs text-gray-600 truncate flex-1 mr-2">{cat}</span>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full bg-black rounded-full" style={{ width: `${Math.round(((stats[cat] || 0) / allLeadStats.total) * 100)}%` }}/>
                        </div>
                        <span className="font-mono-custom text-[10px] text-gray-400 w-6 text-right">{Math.round(((stats[cat] || 0) / allLeadStats.total) * 100)}%</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono-custom text-xs text-gray-300">No data yet</p>
              )}
            </div>
          </div>

          {/* Chat thread */}
          {chatMessages.length > 0 && (
            <div className="mb-4 flex flex-col gap-3">
              {chatMessages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-xs ${msg.role === 'user' ? 'bg-black text-white' : 'bg-gray-100 text-black'} rounded-2xl px-4 py-3`}>
                    <p className="font-mono-custom text-xs leading-relaxed">{msg.text}</p>
                    {msg.scanParams && (
                      <div className="mt-3 pt-3 border-t border-black/10">
                        <div className="flex flex-wrap gap-1 mb-3">
                          {msg.scanParams.keywords.map(kw => (
                            <span key={kw} className="font-mono-custom text-[10px] bg-black/10 px-2 py-0.5 rounded-full text-black/70">{kw}</span>
                          ))}
                        </div>
                        <button onClick={() => triggerIngest(msg.scanParams!)} disabled={scanning || loading}
                          className="w-full font-mono-custom text-[10px] uppercase tracking-widest bg-black text-white px-3 py-2 rounded-lg hover:bg-gray-800 transition disabled:opacity-40">
                          {scanning ? 'Scanning...' : 'Scan Now →'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div className="flex justify-start">
                  <div className="bg-gray-100 rounded-2xl px-4 py-3 flex gap-1">
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'0ms'}}/>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'150ms'}}/>
                    <span className="w-1.5 h-1.5 bg-gray-400 rounded-full animate-bounce" style={{animationDelay:'300ms'}}/>
                  </div>
                </div>
              )}
              <div ref={chatEndRef}/>
            </div>
          )}

        </div>

        {/* Floating chat bar — fixed at bottom */}
        <div className="shrink-0 px-8 py-4 bg-white border-t border-gray-100">
          {chatMessages.length === 0 && (
            <div className="flex items-center gap-2 flex-wrap mb-3">
              {[
                { icon: '👤', label: 'Show me top leads', action: () => setSearchQuery('show me top leads') },
                { icon: '📊', label: 'Leads by industry', action: () => setSearchQuery('leads by industry') },
                { icon: '⏱', label: 'Recent activity', action: () => setSearchQuery('recent leads') },
                { icon: '🔍', label: 'Help me analyze', action: () => setSearchQuery('analyze my leads') },
                ...suggestedDomains.slice(0, 2).map(d => ({ icon: '⚡', label: d, action: () => setSearchQuery(d) })),
              ].map(chip => (
                <button key={chip.label} onClick={chip.action}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 rounded-lg hover:border-gray-400 transition shadow-sm">
                  <span className="text-xs">{chip.icon}</span>
                  <span className="font-mono-custom text-xs text-gray-600">{chip.label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="bg-gray-50 rounded-xl border border-gray-200 px-5 py-3 flex items-center gap-3">
            <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && sendChat()}
              placeholder="What kind of leads are you looking for today?"
              className="flex-1 font-canela text-base text-black placeholder:text-gray-300 outline-none bg-transparent"
            />
            {scanning && <span className="font-mono-custom text-xs text-amber-500 flex items-center gap-1.5 shrink-0"><span className="w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse"/> Scanning</span>}
            {cooldownRemaining > 0 && <span className="font-mono-custom text-xs text-gray-400 shrink-0">⏱ {formatCountdown(cooldownRemaining)}</span>}
            <button onClick={sendChat} disabled={chatLoading || !searchQuery.trim()}
              className="w-9 h-9 bg-black rounded-full flex items-center justify-center hover:bg-gray-800 transition disabled:opacity-30 shrink-0">
              {chatLoading ? <span className="w-2 h-2 bg-white rounded-full animate-pulse"/> : <svg width="13" height="13" viewBox="0 0 24 24" fill="white"><path d="M22 2L11 13M22 2L15 22 11 13 2 9l20-7z"/></svg>}
            </button>
          </div>
        </div>
      </main>

      {/* ── RIGHT PANEL ── */}
      <aside className="w-96 bg-white border-l border-gray-100 flex flex-col h-screen shrink-0">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-sm">🔥</span>
            <span className="font-mono-custom text-xs font-bold uppercase tracking-widest text-black">
              {category === 'Saved' ? 'Saved Leads' : 'Hot Leads'}
            </span>
          </div>
          <span className="font-mono-custom text-xs font-bold text-black">{leads.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {leads.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-300 px-6">
              <p className="font-canela text-4xl mb-3">{category === 'Saved' ? '♡' : '📡'}</p>
              <p className="font-mono-custom text-xs uppercase tracking-widest text-center">
                {category === 'Saved' ? 'No saved leads yet' : 'Hit scan to find leads'}
              </p>
            </div>
          ) : (
            leads.map(lead => {
              const hasEmail = !!lead.contact_email
              const emailRevealed = revealedEmails.has(lead.lead_id)
              const initials = (lead.author || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('').toUpperCase()
              const isHot = lead.timeline === 'Urgent'
              const isWarm = lead.timeline === 'Active'
              return (
                <div key={lead.id} className="px-4 py-4 border-b border-gray-50 hover:bg-gray-50 transition cursor-pointer" onClick={() => setPreviewLead(lead)}>
                  <div className="flex items-start gap-3">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${avatarBg(lead.author || '')}`}>
                      {initials}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2 mb-0.5">
                        <p className="font-canela text-sm font-semibold text-black truncate">{lead.author}</p>
                        <div className="flex items-center gap-1 shrink-0">
                          <span className="font-mono-custom text-[9px] text-gray-400">{lead.intent_score}</span>
                          <span className={`font-mono-custom text-[9px] px-1.5 py-0.5 uppercase tracking-wide ${isHot ? 'bg-black text-white' : isWarm ? 'bg-gray-700 text-white' : 'bg-gray-100 text-gray-500'}`}>
                            {isHot ? 'Hot' : isWarm ? 'Warm' : 'Cool'}
                          </span>
                        </div>
                      </div>
                      {lead.company && <p className="font-mono-custom text-[11px] text-gray-700 font-medium mb-0.5 truncate">{lead.company}</p>}
                      <p className="font-mono-custom text-[10px] text-gray-400 mb-1.5 truncate">
                        {[lead.profession, lead.company].filter(Boolean).join(' · ')}
                      </p>
                      {lead.exact_need && (
                        <p className="font-mono-custom text-[11px] text-gray-600 line-clamp-2 leading-relaxed mb-2">{lead.exact_need}</p>
                      )}
                      <div className="flex items-center gap-1.5 mt-1" onClick={e => e.stopPropagation()}>
                        {/* Email */}
                        {hasEmail ? (
                          emailRevealed ? (
                            <a href={`mailto:${lead.contact_email}`} title={lead.contact_email}
                              className="w-6 h-6 rounded border border-green-200 bg-green-50 flex items-center justify-center hover:bg-green-100 transition">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            </a>
                          ) : (
                            <button onClick={() => toggleEmail(lead.lead_id)} title="Reveal email"
                              className="w-6 h-6 rounded border border-green-200 bg-green-50 flex items-center justify-center hover:bg-green-100 transition">
                              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                            </button>
                          )
                        ) : (
                          <div className="w-6 h-6 rounded border border-gray-100 flex items-center justify-center opacity-30">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                          </div>
                        )}
                        {/* LinkedIn — only for linkedin posts */}
                        {lead.platform === 'linkedin' && (
                          <a href={lead.contact_linkedin || lead.source_url || '#'} target="_blank" rel="noopener noreferrer"
                            className="w-6 h-6 rounded border border-blue-100 bg-blue-50 flex items-center justify-center hover:bg-blue-100 transition">
                            <svg width="10" height="10" viewBox="0 0 24 24"><rect width="24" height="24" rx="3" fill="#0A66C2"/><path d="M7.5 9.5H5v9h2.5v-9zm-1.25-4a1.25 1.25 0 1 0 0 2.5 1.25 1.25 0 0 0 0-2.5zM19 13.5c0-2.5-1.5-4-3.5-4a3.5 3.5 0 0 0-2.5 1V9.5H10.5v9H13v-5c0-1 .5-2 1.75-2S16.5 13 16.5 14v4.5H19V13.5z" fill="white"/></svg>
                          </a>
                        )}
                        {/* X — only for twitter posts, goes to post */}
                        {lead.platform === 'twitter' && lead.source_url && (
                          <a href={lead.source_url} target="_blank" rel="noopener noreferrer"
                            className="w-6 h-6 rounded border border-gray-100 bg-gray-50 flex items-center justify-center hover:bg-gray-100 transition">
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="black"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.763l7.738-8.835L1.254 2.25H8.08l4.253 5.622 5.911-5.622zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
                          </a>
                        )}
                        {/* Save */}
                        <button onClick={() => toggleSave(lead)}
                          className={`ml-auto text-base leading-none transition hover:scale-110 ${savedLeadIds.has(lead.lead_id) ? 'text-black' : 'text-gray-200 hover:text-gray-400'}`}>
                          {savedLeadIds.has(lead.lead_id) ? '♥' : '♡'}
                        </button>
                        <span className="font-mono-custom text-[9px] text-gray-300">{formatRelativeTime(lead.posted_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>
    </div>
  )
}
