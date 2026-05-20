import anthropic
from app.config import ANTHROPIC_API_KEY
import json
import time
from typing import Optional

client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)

# ── Token usage tracking ──────────────────────────────────────────────────────
_session_input_tokens = 0
_session_output_tokens = 0

def get_token_usage() -> dict:
    cost_input  = (_session_input_tokens  / 1_000_000) * 3.00   # $3/1M input (Sonnet)
    cost_output = (_session_output_tokens / 1_000_000) * 15.00  # $15/1M output (Sonnet)
    return {
        "input_tokens":  _session_input_tokens,
        "output_tokens": _session_output_tokens,
        "estimated_cost_usd": round(cost_input + cost_output, 6),
    }

# ── Prompts ───────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a strict B2B buyer-intent classifier. Your job is to find people or companies that want to PAY someone else to do work for them. You are NOT looking for people sharing opinions, asking questions to spark discussion, or promoting their own services.

═══ STEP 1 — HARD REJECT (intent_score: 0, qualified: false) ═══

Reject ANY post that fits one of these patterns:

A) SELLER / SELF-PROMOTER — they are selling, not buying:
   Signs: "my agency", "I built", "I created", "I offer", "we specialize in", "DM me", "reach out", "check out my", "here's how I", "I helped [client]"
   Example: "Here's the exact workflow I built to auto-generate alt text for Shopify. My AI Automation Agency specializes in this. DM me."
   → REJECT. This person is selling a service, not buying one.

B) DISCUSSION / OPINION / THOUGHT LEADERSHIP — asking the audience a question with no procurement intent:
   Signs: post ends with a question to the crowd, "am I overthinking", "curious how you", "what do you think", "agree or disagree", "hot take", "unpopular opinion", no stated budget or vendor search
   Example: "Are AI startups making the same mistake as Twitter API dependents? Curious how you handle vendor lock-in. Am I overthinking this?"
   → REJECT. This is engagement bait. No one is buying anything.

C) JOB SEEKER — individual looking for employment:
   Signs: "open to work", "hire me", "seeking a role", "my resume", "looking for a job", "available for opportunities"
   → REJECT.

D) PURE CONTENT / TIPS POST — sharing knowledge with no procurement need:
   Signs: "5 tips for", "here's what I learned", "thread:", "a story about", listicles, how-to guides with no stated need
   → REJECT.

E) VAGUE MUSING — no specific ask, no problem, no urgency:
   Signs: "thinking about", "someday", "eventually", "exploring the idea of", no concrete need stated
   → REJECT.

═══ STEP 2 — SCORE REAL BUYERS ═══

A post is a REAL BUYER if they are clearly seeking to hire, contract, or purchase a service/tool externally RIGHT NOW.

Strong buyer signals (push score UP):
✓ Explicit ask: "looking for", "need a", "searching for", "want to hire", "can anyone recommend"
✓ Measurable pain: "500 tickets/day", "60% drop in ROI", "4 hours wasted daily"
✓ Budget signal: "budget approved", "willing to pay", "paid tool", "agency budget"
✓ Decision-maker title: founder, CEO, COO, head of, director, VP, manager
✓ Specificity: they know exactly what they need, not vague

Push score DOWN:
✗ No direct ask (just describing a problem without asking for help)
✗ Junior role with no buying power
✗ Hedging language: "maybe", "might", "could potentially"

INTENT SCORE (0–100): Purely the probability they will pay someone externally. Ignore post age, tone, platform.

TIMELINE (language speed only):
- "Urgent" → "ASAP", "this week", "right now", "immediately", "urgent", "desperate"
- "Active" → "looking for", "need a", "searching for", "want to hire"
- "Passive" → "thinking about", "considering", "exploring", "eventually"

EXACT NEED — one tight sentence: what they need + the core problem.
Good: "Needs an AI agency to reduce 500+ daily support tickets by 80%."
Bad: "Interested in AI automation."

Other fields:
- category: use hint if provided, else infer (e.g. "AI Automation", "Marketing", "Aerospace & Defense")
- qualified: true only if intent_score >= 60
- domain: author's industry (e.g. "SaaS", "E-commerce") or ""
- contact_email: extract from post or ""
- contact_phone: extract from post or ""

Return valid JSON only. No explanation. No extra text.
{"category": "AI Automation", "intent_score": 85, "timeline": "Urgent", "qualified": true, "exact_need": "Needs an AI agency to automate 500+ daily customer support tickets.", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

SEARCH_PROMPT = """You map a search query to LinkedIn search keywords that surface posts from BUSINESSES seeking to BUY or CONTRACT external services.

Target posts that sound like: "we need a vendor for X", "looking for a partner to help with Y", "can anyone recommend a service for Z", "our company needs help with".

RULES:
- Keywords must be tightly scoped to the queried domain — do NOT drift into adjacent industries
- AVOID keywords that attract: job seekers, open-to-work posts, recruiters, talent acquisition
- Each keyword must be SHORT (2-5 words max) — long phrases get zero results on LinkedIn
- Think like a buyer in that specific niche posting on LinkedIn
- Use natural short phrases that a decision-maker would actually type in a post

Given a query, generate 4 short buyer-intent keyword phrases for that exact domain.

Return JSON only. No explanation.
{"domain": "clean industry label (e.g. Aerospace & Defense)", "keywords": ["phrase1", "phrase2", "phrase3", "phrase4"]}"""

# ── LLM caller ────────────────────────────────────────────────────────────────
def _call_llm(system: str, user_content: str, temperature: float = 0.1, max_tokens: int = 256, model: str = "claude-haiku-4-5-20251001") -> str:
    global _session_input_tokens, _session_output_tokens
    # TODO: re-enable rate limiting before production deploy
    # delays = [2, 4, 8]
    delays = [0, 0, 0]
    for attempt, delay in enumerate(delays, 1):
        try:
            response = client.messages.create(
                model=model,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user_content}],
            )
            raw = response.content[0].text.strip()
            # Track token usage
            _session_input_tokens  += response.usage.input_tokens
            _session_output_tokens += response.usage.output_tokens
            usage = get_token_usage()
            print(f"[Tokens] in={response.usage.input_tokens} out={response.usage.output_tokens} | session: in={usage['input_tokens']} out={usage['output_tokens']} cost≈${usage['estimated_cost_usd']}")
            # Extract JSON even if model wraps it in extra text
            start = raw.find('{')
            end = raw.rfind('}')
            if start != -1 and end != -1:
                raw = raw[start:end+1]
            json.loads(raw)
            return raw
        except json.JSONDecodeError:
            print(f"[LLM] Attempt {attempt}: invalid JSON, retrying...")
        except anthropic.RateLimitError:
            print(f"[LLM] Rate limit hit, waiting {delay}s...")
        except Exception as e:
            print(f"[LLM] Attempt {attempt} error: {e}")
    return ""


# ── Public functions ──────────────────────────────────────────────────────────
def score_post(post_text: str, category_hint: Optional[str] = None) -> dict:
    hint = f"\nFor this post, prefer category: \"{category_hint}\" if it fits." if category_hint else ""
    raw = _call_llm(SYSTEM_PROMPT + hint, post_text, model="claude-sonnet-4-6")
    if not raw:
        print(f"[Scorer] All retries failed for: {post_text[:60]}")
        return {"category": "None", "intent_score": 0, "timeline": "Passive", "qualified": False}
    print(f"[Scorer] raw={raw}")
    return json.loads(raw)


def map_query_to_search(raw_query: str) -> dict:
    raw = _call_llm(SEARCH_PROMPT, raw_query, temperature=0.3)
    if not raw:
        return {"domain": raw_query.title(), "keywords": [raw_query]}
    print(f"[Search] raw={raw}")
    return json.loads(raw)
