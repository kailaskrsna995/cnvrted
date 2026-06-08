# CNVRTED V2 — Complete Architecture Document

## What cnvrted does

cnvrted finds companies that are actively in-market to buy your service — right now — before you'd ever find them cold calling.

**Who it's for:** Agencies and sales teams who do outbound. They have a service to sell, they need to find buyers.

**The problem:** Cold outreach is a numbers game. You call 100 people to close 2. Most tools give you lists of contacts but no indication of who's ready to buy today.

**What we do differently:** Watch for events that signal buying intent:
- Company just raised money → budget unlocked
- Company just posted a marketing hire → gap to fill
- Founder posted asking for agency recommendations → active buyer
- Company just launched a product → needs content and ads now

**Positioning:** Not competing with Apollo. Sitting on top of it.
Apollo tells you who exists. cnvrted tells you who's ready right now.

---

## Two Modes

### Mode 1 — Live Signal (hot)
Company just hit a trigger event. Show with signal badge. HIGH PRIORITY.

```
🔴 LIVE SIGNALS
Company A  →  Just raised Series A
Company B  →  Hiring Head of Marketing
Company C  →  Founder asking for agency
Company D  →  Just launched product
```

### Mode 2 — Potential Match (warm)
No live trigger right now but company matches ICP perfectly.
Fall back to ICP-based search. Never show empty list.

```
🟡 POTENTIAL MATCHES
Company E  →  Matches your ICP
Company F  →  Matches your ICP
```

---

## V1 vs V2

| | V1 | V2 |
|---|---|---|
| Onboarding | Chat → keywords | Website URL → auto ICP |
| Sources | LinkedIn + Twitter (Apify) | 5 agents, multiple sources |
| Searching | Keyword phrases | Semantic search (meaning) |
| Matching | Generic | Vector similarity per user |
| Enrichment | Manual reveal | Automatic waterfall |
| Delivery | Manual scan | Daily digest + email |
| Memory | None | Short + long term |
| Learning | None | Adapts from user behaviour |
| Scale | Single server | Queue-based, horizontal |

---

## Complete Workflow

```
USER SIGNS UP
enters: website URL + LinkedIn URL + what they sell + who they target
        ↓
PROFILE AGENT (runs once on signup, ~30 seconds)
Jina Reader crawls website + LinkedIn
Claude Sonnet extracts structured profile
Produces:
  UserContext.md → what they sell, tone, clients, differentiators
  ICP.md → industry, company size, geography, buyer title,
            pain points, budget signals, trigger events
Stored as:
  → raw text in Supabase (for LLM context)
  → vector embedding via pgvector (for matching)
  → preferences object (learns over time)
        ↓
CONTEXT LOADER (runs before every agent cycle)
For each active user:
  Load UserContext.md + ICP.md
  Load ICP vector
  Load seen_signal_hashes (never show same lead twice)
  Load preferences (learned signal weights)
  Package into user_context object
Context loaded ONCE per run — agents never hit DB mid-run
        ↓
AGENT FLEET (5 agents, run in parallel, globally)
        │
        ├── Reddit Agent        every 2h
        ├── Funding Agent       every 6h
        ├── Hiring Agent        every 6h
        ├── Buyer Intent Agent  every 3h
        └── News Agent          every 12h
        │
        ▼
SIGNAL QUEUE (Upstash Redis)
Every signal lands here
Deduped by SHA256 hash
Nothing lost if system crashes
300 concurrent users absorbed
        ↓
MATCHING ENGINE (pgvector)
Signal text → vector
Cosine similarity vs all user ICP vectors
One query → finds which users care about this signal
Threshold: 0.70 similarity
        ↓
SCORING (Claude Haiku)
Score ≥ 0.60 → pass
Score < 0.60 → drop
Scored once per signal per matched user
        ↓
ENRICHMENT WATERFALL
Hunter.io → FullEnrich → Apollo → partial if all fail
Finds: decision maker name + title + email + phone + LinkedIn
Cached per company domain (never pay twice)
        ↓
OUTREACH GENERATION (Claude Sonnet)
One personalised line per lead per user
Uses UserContext.md + signal type + decision maker title
Max 20 words
        ↓
LIST ASSEMBLY (7am daily per user timezone)
Ranked by: intent score → freshness → has contact info
Max 20 leads per day
        ↓
DELIVERY
  → Dashboard: table view, filter, export CSV, copy outreach
  → Email digest: Resend, 8am daily
  → CSV: Company, Decision Maker, Title, Email, Phone,
         Signal Type, Why Flagged, Outreach Line, Source URL, Date
```

---

## The 5 Agents

### Agent 1 — Reddit Agent
- **Runs:** Every 2 hours
- **Purpose:** Find people actively asking for services
- **Tools:** PRAW (free), Keyword builder, Claude Haiku, Dedup checker
- **Subreddits:** r/entrepreneur, r/smallbusiness, r/startups, r/SaaS, r/ecommerce, r/marketing, r/agency + niche subreddits from ICP
- **Failproof:** Rate limit → wait 60s retry | 0 results → broaden query | API down → skip run

### Agent 2 — Funding Agent
- **Runs:** Every 6 hours
- **Purpose:** Companies that just got money = budget unlocked
- **Tools:** Crunchbase API, Jina Reader, pgvector, Claude Haiku, Dedup checker
- **Failproof:** API limit → use cached data | Jina blocked → use Crunchbase data only

### Agent 3 — Hiring Agent
- **Runs:** Every 6 hours
- **Purpose:** Company hiring marketing role = they need outside help now
- **Tools:** Serper API, Jina Reader, Claude Haiku, Dedup checker
- **Searches:** Greenhouse, Lever, Workable, Ashby for marketing/growth roles
- **Failproof:** Serper limit → cache results | Auth wall → skip + log

### Agent 4 — Buyer Intent Agent
- **Runs:** Every 3 hours
- **Purpose:** Find buyer posts across entire web semantically
- **Tools:** Exa API (semantic search), Tavily API (fallback), Jina Reader, Claude Haiku, Dedup checker
- **How:** ICP → semantic queries → search entire web by meaning → finds buyers who don't use "agency" language
- **Failproof:** Exa fails → Tavily | Both fail → skip + log

### Agent 5 — News Agent
- **Runs:** Every 12 hours
- **Purpose:** Company events predicting buying (expansion, rebrand, new CMO)
- **Tools:** Google News RSS (free), Serper News API, Jina Reader, Claude Haiku
- **Failproof:** RSS always available, lowest priority, safe to skip

---

## Why Semantic Search Not Keywords

Normal keyword search finds exact words.
Semantic search finds exact meaning.

```
Query: "looking for paid social agency"

Keyword finds: only posts with those exact words

Semantic finds:
  "our ROAS is terrible"
  "drowning in ad spend"
  "Facebook ads not converting"
  "need help with Meta campaigns"
  "who manages your paid media?"
```

Exa.ai powers this. Converts queries to vectors. Finds pages with similar meaning across the entire web.

---

## Memory Architecture

### Three Types of Memory

| Type | Storage | Lifetime | Purpose |
|---|---|---|---|
| Short term | Redis | 24 hours | Current run state |
| Long term | Supabase | Forever | Seen signals + preferences |
| User context | Supabase | Forever | ICP + vectors + learned weights |

### Learning Loop
```
User exports 10 leads
9 were funding signals → funding weighted +0.2 for this user
1 was Reddit post → Reddit weighted -0.1 for this user
Agents adapt over time per user
```

### Context Rules
- Context loaded ONCE per run at start
- Never hit DB mid-run
- Results written back ONCE at end
- Vector embeddings regenerated if ICP changes

---

## How Multiple Users Are Handled

NOT separate agents per user. ONE global fleet with per-user context.

```
Reddit Agent runs ONCE
Finds 50 posts
For each post:
  → convert to vector
  → query pgvector: "which users match this?"
  → returns [user_123, user_456, user_789]
  → score against each user's ICP.md
  → personalised outreach per matched user
```

**LLM cost is per signal, not per user.**
100 signals/day = 100 Haiku calls regardless of user count.

---

## Robustness Rules

```
Every API call:     try → fail → retry 3x → log → skip → continue
Every signal:       hash check → never process twice
Every enrichment:   cache check → never pay twice
Every agent:        reports last run time + signals found
Every user:         completely isolated data
Queue:              signals survive crashes
Dead letter queue:  failed signals after 3 retries → flagged
```

---

## Scaling Architecture

### The Key Insight
Run agents ONCE globally. Match to users via vector search. One query regardless of user count.

| Users | Stack | Monthly Cost |
|---|---|---|
| 0-100 | Railway + Supabase free | ~$30 |
| 100-1k | Railway Pro + Redis + Supabase Pro | ~$200 |
| 1k-10k | Multiple workers + cluster ICPs | ~$600 |
| 10k-100k | Kubernetes + Kafka + read replicas | ~$3,000 |

---

## Database Schema (15 Tables)

### Table 1 — users
```sql
id                uuid          PK
email             text          unique
created_at        timestamp
last_active_at    timestamp
subscription      text          beta/active/churned
```

### Table 2 — user_profiles
```sql
id                uuid          PK
user_id           uuid          FK → users
website_url       text
linkedin_url      text
service_description  text
target_description   text
user_context      text          UserContext.md
icp_text          text          ICP.md
icp_vector        vector(1536)  pgvector embedding
created_at        timestamp
updated_at        timestamp
```

### Table 3 — user_preferences
```sql
id                uuid          PK
user_id           uuid          FK → users
signal_weights    jsonb         {funding:1.2, hiring:0.8, reddit:1.0}
min_intent_score  float         default 0.60
preferred_industries  text[]
avoided_industries    text[]
leads_per_day     int           default 20
email_digest      bool          default true
digest_time       time          default 08:00
timezone          text
total_interactions int          default 0
updated_at        timestamp
```

### Table 4 — signals
```sql
id                uuid          PK
signal_hash       text          unique (SHA256 dedup key)
signal_type       text          funding/hiring/buyer_post/news/semantic
company_name      text
company_url       text
company_domain    text
raw_text          text
source_url        text
source_platform   text          reddit/crunchbase/serper/exa/rss
funding_amount    numeric       nullable
funding_round     text          nullable
job_title         text          nullable
signal_date       timestamp
ingested_at       timestamp
status            text          pending/processing/processed/failed
```

### Table 5 — seen_signals
```sql
id                uuid          PK
user_id           uuid          FK → users
signal_hash       text
seen_at           timestamp
action            text          exported/saved/ignored/dismissed

UNIQUE (user_id, signal_hash)
```

### Table 6 — leads
```sql
id                uuid          PK
user_id           uuid          FK → users
signal_id         uuid          FK → signals
company_name      text
company_url       text
company_domain    text
signal_type       text
why_flagged       text
intent_score      float
decision_maker    text
title             text
email             text
phone             text
linkedin_url      text
outreach_line     text
source_url        text
signal_date       timestamp
list_date         date
status            text          new/viewed/exported/saved/dismissed
created_at        timestamp
```

### Table 7 — enrichment_cache
```sql
id                uuid          PK
company_domain    text          unique
company_name      text
decision_maker    text
title             text
email             text
phone             text
linkedin_url      text
source            text          hunter/fullenrich/apollo
enriched_at       timestamp
expires_at        timestamp     30 days TTL
```

### Table 8 — agent_runs
```sql
id                uuid          PK
agent_name        text
started_at        timestamp
completed_at      timestamp
status            text          running/completed/failed
signals_found     int
signals_processed int
signals_discarded int
error_message     text
metadata          jsonb
```

### Table 9 — daily_lists
```sql
id                uuid          PK
user_id           uuid          FK → users
list_date         date
lead_count        int
email_sent        bool
email_sent_at     timestamp
csv_exported      bool
csv_exported_at   timestamp
created_at        timestamp

UNIQUE (user_id, list_date)
```

### Table 10 — api_logs
```sql
id                uuid          PK
service           text
status_code       int
success           bool
error_message     text
response_time_ms  int
called_at         timestamp
```

### Table 11 — companies (static DB / moat)
```sql
id                uuid          PK
domain            text          unique
name              text
website_url       text
linkedin_url      text
industry          text
sub_industry      text
company_size      text
estimated_revenue text
founded_year      int
headquarters      text
description       text
technologies      text[]
last_enriched_at  timestamp
first_seen_at     timestamp
times_appeared    int
```

### Table 12 — decision_makers (static DB / moat)
```sql
id                uuid          PK
company_id        uuid          FK → companies
full_name         text
title             text
seniority         text          c_level/vp/director/manager
department        text
email             text
phone             text
linkedin_url      text
twitter_url       text
location          text
enrichment_source text
first_seen_at     timestamp
last_verified_at  timestamp
confidence_score  float
```

### Table 13 — company_signals_history (static DB / moat)
```sql
id                uuid          PK
company_id        uuid          FK → companies
signal_type       text
signal_detail     text
signal_date       timestamp
source_url        text
recorded_at       timestamp
```

### Table 14 — lead_authors (static DB / moat)
```sql
id                uuid          PK
platform          text
platform_user_id  text
username          text
display_name      text
profile_url       text
bio               text
location          text
follower_count    int
company           text
title             text
first_seen_at     timestamp
post_count        int
intent_history    jsonb
```

### Table 15 — raw_posts (static DB / moat)
```sql
id                uuid          PK
post_hash         text          unique
platform          text
author_id         uuid          FK → lead_authors
company_id        uuid          FK → companies
raw_text          text
post_url          text
posted_at         timestamp
ingested_at       timestamp
intent_score      float
signal_type       text
used_in_lead      bool
```

---

## External APIs

| Service | Purpose | Free Tier | Paid |
|---|---|---|---|
| Jina Reader | Read any webpage | Unlimited free | Free |
| PRAW | Reddit API | Free | Free |
| Crunchbase API | Funding rounds | 200 calls/day | $599/mo |
| Serper API | Google search | 2,500 queries | $50/mo |
| Exa API | Semantic search | 1,000/month | $7/1k |
| Tavily API | Search fallback | 1,000/month | $8/1k |
| Hunter.io | Email finding | 50/month | $49/mo |
| FullEnrich | Email + phone | 50 credits | Per credit |
| Apollo.io | Enrichment fallback | Limited | $49/mo |
| Upstash Redis | Signal queue | 10k cmds/day | $10/mo |
| Claude Haiku | Intent scoring | — | ~$0.001/signal |
| Claude Sonnet | Outreach generation | — | ~$0.003/lead |
| Resend | Email digest | 3,000/month | $20/mo |
| pgvector (Supabase) | Vector similarity | Free built-in | Free |

---

## Monthly Cost Estimates

### Beta (300 users): ~$300/month → $1/user/month
### Growth (500 users): ~$1,742/month → Revenue $49,500 → Margin 96%

---

## 25-Day Build Order

### Week 1 — Foundation (Days 1-5)
- Day 1-2: Branch setup, all 15 tables, pgvector, Redis, env vars
- Day 3-4: Profile Agent (URL → UserContext + ICP + vector)
- Day 5: Matching Engine (pgvector similarity function)

### Week 2 — Agents (Days 6-10)
- Day 6-7: Reddit Agent (PRAW + scoring + scheduler)
- Day 8-9: Funding Agent (Crunchbase + cache + scheduler)
- Day 10: Buyer Intent Agent (Exa semantic + Tavily fallback)

### Week 3 — Enrichment + Scoring (Days 11-15)
- Day 11-12: Signal Queue + Scoring (Redis worker + Haiku)
- Day 13-14: Enrichment Waterfall (Hunter → FullEnrich → Apollo + cache)
- Day 15: Hiring Agent + News Agent

### Week 4 — Delivery (Days 16-20)
- Day 16-17: Outreach generation + List assembly
- Day 18-19: Dashboard UI (table, filter, CSV export)
- Day 20: Email digest (Resend + 8am scheduler)

### Week 5 — Polish (Days 21-25)
- Day 21-22: Memory + learning (seen_signals + preference weights)
- Day 23-24: Health monitor + agent dashboard
- Day 25: Load test 300 users + fix + seed leads + launch

---

## Non-Negotiables

```
✦ Dedup works perfectly       → seen_signals UNIQUE constraint
✦ Enrichment cache works      → never pay twice per company
✦ Queue never loses signals   → Redis persistence
✦ User data isolated          → always filter by user_id
✦ Agents fail gracefully      → log, never crash
✦ Empty list never shown      → fall back to ICP matching
✦ Same lead never shown twice → seen_signals check before delivery
```

---

## The Static Database Moat

Every signal, company, decision maker, and post stored permanently.
Over time: proprietary database of companies + buying patterns.
Year 3: predict who's about to buy before they post about it.
This is what Apollo and Bombora spent years building.
We build it automatically from day one as a side effect of running.

---

*Document generated: June 2026*
*Status: Architecture locked. Ready to build.*
