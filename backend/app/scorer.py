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
    cost_input  = (_session_input_tokens  / 1_000_000) * 1.00   # $1/1M input
    cost_output = (_session_output_tokens / 1_000_000) * 5.00   # $5/1M output
    return {
        "input_tokens":  _session_input_tokens,
        "output_tokens": _session_output_tokens,
        "estimated_cost_usd": round(cost_input + cost_output, 6),
    }

# ── Prompts ───────────────────────────────────────────────────────────────────
SYSTEM_PROMPT = """You are a B2B commercial intent classifier. Analyze this LinkedIn post and return JSON only.

STEP 1 — REJECT immediately (qualified: false, intent_score: 0) if the post is:
- An individual looking for a job for themselves ("open to work", "hire me", "seeking a role")
- Pure opinion or thought leadership with zero buying signal
- Vague curiosity with no specific ask ("what do you think about AI?", "anyone else notice...")
- Content marketing or tips post with no procurement need stated

Everything else — companies needing services, tools, vendors, agencies, contractors — is a potential buyer.

STEP 2 — SCORE the remaining posts:

INTENT SCORE (0–100): Probability they will hire or contract a service externally.
↑ Score higher for:
- Specific, well-defined problem with measurable pain ("500 tickets/day", "60% drop in ROI")
- Budget mentioned or implied ("approved budget", "willing to pay", "paid ads")
- Decision-maker role (founder, CEO, head of, director, manager)
- Actively requesting vendor / agency / tool recommendations right now
↓ Score lower for:
- Vague language ("thinking about", "exploring", "considering", "someday")
- No direct ask or call to action
- Junior role with no buying authority
DO NOT factor post age, tone, or recency into this score.

TIMELINE (based on language speed only):
- "Urgent" — "ASAP", "this week", "right now", "immediately", "urgent"
- "Active" — "looking for", "need a", "searching for", "want to hire"
- "Passive" — "thinking about", "considering", "exploring", "eventually"

EXACT NEED — one tight sentence: what they need + the core problem.
Example: "Needs an AI automation agency to reduce 500+ daily support tickets."

Other fields:
- category: use hint if provided, else infer (e.g. "AI Automation", "Marketing", "Aerospace & Defense")
- qualified: true only if intent_score >= 60
- domain: author's industry (e.g. "SaaS", "E-commerce") or ""
- contact_email: extract from post or ""
- contact_phone: extract from post or ""

Return valid JSON only. No explanation.
{"category": "AI Automation", "intent_score": 85, "timeline": "Urgent", "qualified": true, "exact_need": "Needs an AI agency to automate 500+ daily customer support tickets.", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

SEARCH_PROMPT = """You map a search query to LinkedIn search keywords that surface posts from BUSINESSES seeking to BUY or CONTRACT external services.

Target posts that sound like: "we need a vendor for X", "looking for a partner to help with Y", "can anyone recommend a service for Z", "our company needs help with".

RULES:
- Keywords must be tightly scoped to the queried domain — do NOT drift into adjacent industries
- AVOID keywords that attract: job seekers, open-to-work posts, recruiters, talent acquisition
- Each keyword should be a natural buyer-intent phrase, not a single word
- Think like a buyer in that specific niche posting on LinkedIn

Given a query, generate 4 buyer-intent keyword phrases for that exact domain.

Return JSON only. No explanation.
{"domain": "clean industry label (e.g. Aerospace & Defense)", "keywords": ["phrase1", "phrase2", "phrase3", "phrase4"]}"""

# ── LLM caller ────────────────────────────────────────────────────────────────
def _call_llm(system: str, user_content: str, temperature: float = 0.1, max_tokens: int = 256) -> str:
    global _session_input_tokens, _session_output_tokens
    delays = [2, 4, 8]
    for attempt, delay in enumerate(delays, 1):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
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
            # Validate JSON before returning
            json.loads(raw)
            return raw
        except json.JSONDecodeError:
            print(f"[LLM] Attempt {attempt}: invalid JSON, retrying...")
        except anthropic.RateLimitError:
            print(f"[LLM] Rate limit hit, waiting {delay}s...")
        except Exception as e:
            print(f"[LLM] Attempt {attempt} error: {e}")
        if attempt < len(delays):
            time.sleep(delay)
    return ""


# ── Public functions ──────────────────────────────────────────────────────────
def score_post(post_text: str, category_hint: Optional[str] = None) -> dict:
    hint = f"\nFor this post, prefer category: \"{category_hint}\" if it fits." if category_hint else ""
    raw = _call_llm(SYSTEM_PROMPT + hint, post_text)
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
