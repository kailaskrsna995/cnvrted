from groq import Groq
from app.config import GROQ_API_KEY
import json
import time
from typing import Optional

client = Groq(api_key=GROQ_API_KEY)

SYSTEM_PROMPT = """You are a commercial intent classifier for B2B service leads. Given a LinkedIn post:

Step 1 - HARD FILTER. Immediately return qualified: false, intent_score: 0 if the post is ONLY:
- An individual looking for a job for themselves ("open to work", "hire me", "seeking a role")
- A purely personal story or opinion with zero commercial spend signal

Everything else is a potential customer.

Step 2 - Extract the following fields:

INTENT SCORE (0-100): Score ONLY on probability they will buy or contract a service.
Score higher for:
- They clearly know what they need (specific ask, not vague)
- Budget is mentioned or implied ("approved budget", "paid", "willing to pay")
- They are the decision maker (founder, CEO, manager, head of)
- They are actively asking for recommendations or vendors right now
- The problem they describe is urgent and well-defined
Score lower for:
- Vague interest ("thinking about", "exploring", "someday")
- No clear ask or need stated
- Junior role with no buying power
DO NOT factor in timeline, tone, or post recency into this score.

TIMELINE: How soon do they need it — based purely on language speed:
- "Urgent" — language signals immediate need ("ASAP", "this week", "urgent", "right now", "immediately")
- "Active" — actively looking but no hard deadline ("looking for", "need a", "searching for")
- "Passive" — exploratory or future intent ("thinking about", "considering", "eventually")

Other fields:
- category: use the hint if provided, else infer (e.g. "AI Automation", "Marketing", "Aerospace & Defense")
- qualified: true only if intent_score >= 60
- exact_need: one sentence — exactly what they need
- domain: industry of the author (e.g. "SaaS", "Healthcare") or ""
- contact_email: if in post, else ""
- contact_phone: if in post, else ""

Only return valid JSON. No explanation.
{"category": "AI Automation", "intent_score": 85, "timeline": "Urgent", "qualified": true, "exact_need": "Looking for an agency to automate customer support tickets using AI", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

SEARCH_PROMPT = """You map a search query to LinkedIn search keywords that surface posts from BUSINESSES seeking to BUY or CONTRACT external services — not job seekers, not recruiters.

Target posts that sound like: "we need a vendor for X", "looking for a partner to help with Y", "can anyone recommend a service for Z", "our company needs help with".

AVOID generating keywords that attract: job seekers, open-to-work posts, recruiters looking for candidates, talent acquisition.

Given a query (e.g. "aerospace"), generate 4 keywords that find COMPANIES in that sector actively seeking to procure services or solutions.

Return JSON only. No explanation.
{"domain": "clean industry label (e.g. Aerospace & Defense)", "keywords": ["phrase1", "phrase2", "phrase3", "phrase4"]}"""

def _call_llm(messages: list, temperature: float = 0.1) -> str:
    """Call LLM with retry + exponential backoff on failure."""
    delays = [2, 4, 8]
    for attempt, delay in enumerate(delays, 1):
        try:
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=messages,
                temperature=temperature,
            )
            raw = response.choices[0].message.content.strip()
            # Validate it's parseable JSON before returning
            json.loads(raw)
            return raw
        except json.JSONDecodeError:
            print(f"[LLM] Attempt {attempt}: invalid JSON, retrying...")
        except Exception as e:
            print(f"[LLM] Attempt {attempt} error: {e}")
        if attempt < len(delays):
            time.sleep(delay)
    return ""


def score_post(post_text: str, category_hint: Optional[str] = None) -> dict:
    hint = f"\nFor this post, prefer category: \"{category_hint}\" if it fits." if category_hint else ""
    raw = _call_llm([
        {"role": "system", "content": SYSTEM_PROMPT + hint},
        {"role": "user", "content": post_text}
    ])
    if not raw:
        print(f"[Scorer] All retries failed for: {post_text[:60]}")
        return {"category": "None", "intent_score": 0, "urgency": "Low", "qualified": False}
    print(f"[Scorer] raw={raw}")
    return json.loads(raw)


def map_query_to_search(raw_query: str) -> dict:
    raw = _call_llm([
        {"role": "system", "content": SEARCH_PROMPT},
        {"role": "user", "content": raw_query}
    ], temperature=0.3)
    if not raw:
        return {"domain": raw_query.title(), "keywords": [raw_query]}
    print(f"[Search] raw={raw}")
    return json.loads(raw)
