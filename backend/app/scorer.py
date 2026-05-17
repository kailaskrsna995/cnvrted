from groq import Groq
from app.config import GROQ_API_KEY
import json
from typing import Optional

client = Groq(api_key=GROQ_API_KEY)

SYSTEM_PROMPT = """You are a commercial intent classifier. Given a LinkedIn post:

Step 1 - Filter: Is this post expressing genuine commercial intent to buy, hire, or find a service? If it is news, personal opinion, promotion, or general advice with no buying signal, return qualified: false with intent_score 0.

Step 2 - If qualified, extract these fields:
- category: use the hint category if provided and it fits, otherwise infer the best label (e.g. "AI Automation", "Marketing", "Film & Media", "E-commerce")
- intent_score: integer 0-100 (strength of buying/hiring intent)
- urgency: "High", "Medium", or "Low"
- qualified: true if intent_score >= 60
- exact_need: one sentence — exactly what service or solution they are looking for
- domain: the industry or business domain of the author (e.g. "SaaS", "E-commerce", "Healthcare") or "" if unknown
- contact_email: email address if mentioned in the post, else ""
- contact_phone: phone number if mentioned in the post, else ""

Only return valid JSON. No explanation. Example:
{"category": "AI Automation", "intent_score": 85, "urgency": "High", "qualified": true, "exact_need": "Looking for an agency to automate customer support tickets using AI", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

SEARCH_PROMPT = """You map a user's search query to LinkedIn search keywords for surfacing posts with commercial buying intent.

Given a query (e.g. "filmmaker", "restaurant owner needing marketing"), return:
- domain: clean industry label (e.g. "Film & Media", "Food & Beverage")
- keywords: array of 3-5 search phrases that would surface LinkedIn posts from people actively looking to hire or buy services in this space

Only return valid JSON. Example:
{"domain": "Film & Media", "keywords": ["filmmaker looking for", "video production help needed", "film crew hiring", "post production services"]}"""

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
