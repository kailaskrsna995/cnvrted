export type Lead = {
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
  outreach_line?: string
}

export type ActiveSearch = { domain: string; keywords: string[] }

export type ScanStats = {
  total_scanned: number
  total_rejected: number
  total_saved: number
}
