from groq import Groq
from app.config import GROQ_API_KEY
import json

client = Groq(api_key=GROQ_API_KEY)

SYSTEM_PROMPT = """You are a commercial intent classifier. Given a LinkedIn post:

Step 1 - Filter: Is this post expressing genuine commercial intent to buy, hire, or find a service? If it is news, personal opinion, promotion, or general advice with no buying signal, return qualified: false with intent_score 0.

Step 2 - If qualified, extract these fields:
- category: "AI Automation" or "Marketing" or "None"
- intent_score: integer 0-100 (strength of buying/hiring intent)
- urgency: "High", "Medium", or "Low"
- qualified: true if intent_score >= 60 and category != "None"
- exact_need: one sentence — exactly what service or solution they are looking for
- domain: the industry or business domain of the author (e.g. "SaaS", "E-commerce", "Healthcare") or "" if unknown
- contact_email: email address if mentioned in the post, else ""
- contact_phone: phone number if mentioned in the post, else ""

Only return valid JSON. No explanation. Example:
{"category": "AI Automation", "intent_score": 85, "urgency": "High", "qualified": true, "exact_need": "Looking for an agency to automate customer support tickets using AI", "domain": "SaaS", "contact_email": "", "contact_phone": ""}"""

def score_post(post_text: str) -> dict:
    try:
        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
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
