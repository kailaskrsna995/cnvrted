import anthropic
from app.config import ANTHROPIC_API_KEY
import json
import time
from typing import Optional

def _get_client():
    from app.config import ANTHROPIC_API_KEY as _key
    return anthropic.Anthropic(api_key=_key)

# ── Token usage tracking ──────────────────────────────────────────────────────
_session_input_tokens = 0
_session_output_tokens = 0
_session_cache_write_tokens = 0
_session_cache_read_tokens = 0

def get_token_usage() -> dict:
    # Sonnet pricing: $3/1M input, $15/1M output, $3.75/1M cache write, $0.30/1M cache read
    cost = (
        (_session_input_tokens       / 1_000_000) * 3.00 +
        (_session_output_tokens      / 1_000_000) * 15.00 +
        (_session_cache_write_tokens / 1_000_000) * 3.75 +
        (_session_cache_read_tokens  / 1_000_000) * 0.30
    )
    return {
        "input_tokens":       _session_input_tokens,
        "output_tokens":      _session_output_tokens,
        "cache_write_tokens": _session_cache_write_tokens,
        "cache_read_tokens":  _session_cache_read_tokens,
        "estimated_cost_usd": round(cost, 6),
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

Buyers post their PROBLEM or ask their network for recommendations. Search for pain points + recommendation requests.

Good keyword patterns:
- "recommend [specific freelancer/agency type]" e.g. "recommend freelance developer"
- "need help [specific task]" e.g. "need help building app"
- "anyone know [service]" e.g. "anyone know good developer"
- "looking for freelancer [task]" e.g. "looking for freelancer build website"

RULES:
- AVOID "#hiring", "open position", "job opening" — returns HR/recruiter posts
- USE "looking to hire freelancer", "want to hire contractor" — these are buyers
- Use "freelancer", "agency", "contractor", "outsource" — signals someone buying a service
- Keep phrases 3-5 words
- Think: business owner or creative professional needing to pay someone for a specific project

Given a query, generate 4 question-style buyer-intent keyword phrases for that exact domain.

Return JSON only. No explanation.
{"domain": "clean industry label (e.g. Aerospace & Defense)", "keywords": ["phrase1", "phrase2", "phrase3", "phrase4"]}"""

# ── LLM caller ────────────────────────────────────────────────────────────────
def _call_llm(system, user_content: str, temperature: float = 0.1, max_tokens: int = 256, model: str = "claude-haiku-4-5-20251001") -> str:
    """system can be a plain string or a list of content blocks (for prompt caching)."""
    global _session_input_tokens, _session_output_tokens, _session_cache_write_tokens, _session_cache_read_tokens
    client = _get_client()
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
            # Track token usage (including cache hits/writes)
            _session_input_tokens  += response.usage.input_tokens
            _session_output_tokens += response.usage.output_tokens
            _session_cache_write_tokens += getattr(response.usage, "cache_creation_input_tokens", 0)
            _session_cache_read_tokens  += getattr(response.usage, "cache_read_input_tokens", 0)
            usage = get_token_usage()
            print(f"[Tokens] in={response.usage.input_tokens} out={response.usage.output_tokens} cache_write={getattr(response.usage,'cache_creation_input_tokens',0)} cache_read={getattr(response.usage,'cache_read_input_tokens',0)} cost≈${usage['estimated_cost_usd']}")
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
    # Build system as content blocks — SYSTEM_PROMPT is cached, hint appended uncached
    system_blocks = [{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}]
    if category_hint:
        system_blocks.append({"type": "text", "text": f"\nFor this post, prefer category: \"{category_hint}\" if it fits."})

    tokens_in_before  = _session_input_tokens
    tokens_out_before = _session_output_tokens
    raw = _call_llm(system_blocks, post_text, model="claude-sonnet-4-6")
    tokens_used = (
        (_session_input_tokens  - tokens_in_before) +
        (_session_output_tokens - tokens_out_before)
    )
    if not raw:
        print(f"[Scorer] All retries failed for: {post_text[:60]}")
        return {"category": "None", "intent_score": 0, "timeline": "Passive", "qualified": False, "tokens_used": 0}
    print(f"[Scorer] raw={raw}")
    result = json.loads(raw)
    result["tokens_used"] = tokens_used
    return result


def map_query_to_search(raw_query: str) -> dict:
    system_blocks = [{"type": "text", "text": SEARCH_PROMPT, "cache_control": {"type": "ephemeral"}}]
    raw = _call_llm(system_blocks, raw_query, temperature=0.0)
    if not raw:
        return {"domain": raw_query.title(), "keywords": [raw_query]}
    print(f"[Search] raw={raw}")
    return json.loads(raw)
