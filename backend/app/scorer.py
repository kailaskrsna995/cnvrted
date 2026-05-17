from groq import Groq
from app.config import GROQ_API_KEY
import json
from typing import Optional

client = Groq(api_key=GROQ_API_KEY)

SYSTEM_PROMPT = """You are a commercial intent classifier for B2B service leads. Given a LinkedIn post:

Step 1 - HARD FILTER. Immediately return qualified: false, intent_score: 0 if the post is ONLY:
- An individual looking for a job for themselves ("I'm open to work", "hire me", "looking for opportunities", "seeking a role")
- A purely personal story or opinion with zero commercial intent and no spend signal

Everything else is a potential customer. A company hiring, a recruiter sourcing, a business buying tools, a founder seeking vendors — all qualify if there is spend or procurement intent.

Step 2 - Only if it passes Step 1: Does this post signal that someone has budget and a need — whether hiring, buying, contracting, or procuring? If yes, extract:
- category: use the hint if provided, else infer (e.g. "AI Automation", "Marketing", "Aerospace & Defense")
- intent_score: integer 0-100
- urgency: "High", "Medium", or "Low"
- qualified: true only if intent_score >= 60
- exact_need: one sentence — exactly what service or solution they need
- domain: industry of the author (e.g. "SaaS", "Healthcare") or ""
- contact_email: if in post, else ""
- contact_phone: if in post, else ""

Only return valid JSON. No explanation.
{"category": "AI Automation", "intent_score": 85, "urgency": "High", "qualified": true, "exact_need": "Looking for an agency to automate customer support tickets using AI", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

SEARCH_PROMPT = """You map a search query to LinkedIn search keywords that surface posts from BUSINESSES seeking to BUY or CONTRACT external services — not job seekers, not recruiters.

Target posts that sound like: "we need a vendor for X", "looking for a partner to help with Y", "can anyone recommend a service for Z", "our company needs help with".

AVOID generating keywords that attract: job seekers, open-to-work posts, recruiters looking for candidates, talent acquisition.

Given a query (e.g. "aerospace"), generate 4 keywords that find COMPANIES in that sector actively seeking to procure services or solutions.

Return JSON only. No explanation.
{"domain": "clean industry label (e.g. Aerospace & Defense)", "keywords": ["phrase1", "phrase2", "phrase3", "phrase4"]}"""

def score_post(post_text: str, category_hint: Optional[str] = None) -> dict:
    hint = f"\nFor this post, prefer category: \"{category_hint}\" if it fits." if category_hint else ""
    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT + hint},
                {"role": "user", "content": post_text}
            ],
            temperature=0.1,
        )
        raw = response.choices[0].message.content.strip()
        print(f"[Scorer] raw={raw}")
        return json.loads(raw)
    except Exception as e:
        print(f"[Scorer] Error: {e}")
        return {"category": "None", "intent_score": 0, "urgency": "Low", "qualified": False}

def map_query_to_search(raw_query: str) -> dict:
    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SEARCH_PROMPT},
                {"role": "user", "content": raw_query}
            ],
            temperature=0.3,
        )
        raw = response.choices[0].message.content.strip()
        print(f"[Search] raw={raw}")
        return json.loads(raw)
    except Exception as e:
        print(f"[Search] Error: {e}")
        return {"domain": raw_query.title(), "keywords": [raw_query]}
