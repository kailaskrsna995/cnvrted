from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, List
import anthropic
import json
import traceback

router = APIRouter(prefix="/chat", tags=["chat"])


def _get_client():
    from app.config import ANTHROPIC_API_KEY
    return anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


def _extract_json(raw: str) -> dict:
    start, end = raw.find('{'), raw.rfind('}')
    if start == -1:
        return {}
    try:
        return json.loads(raw[start:end + 1])
    except Exception:
        return {}


# ── Prompts ───────────────────────────────────────────────────────────────────

HAIKU_CLASSIFIER = """You work for cnvrted — a lead generation tool built for agencies to find clients.

Classify the message as "casual" or "search":
- casual: pure small talk with zero business context ("hey", "hi", "thanks", "lol", "what is this?")
- search: mentions ANYTHING about their agency, service, clients, industry, or what they offer

If casual, reply warmly in 1-2 sentences and naturally ask what their agency specialises in. Sound human, not robotic.

Examples:
"hey" -> casual -> "Hey! What does your agency do? I'll find the right buyers for you."
"how does this work?" -> casual -> "Ask me what you sell and I'll find businesses on LinkedIn actively looking to hire someone like you."
"we do paid ads" -> search
"video editor" -> search
"I run a branding agency" -> search

Return JSON only — no extra text:
{"intent": "casual" | "search", "response": "reply text if casual, empty string if search"}"""


SONNET_SYSTEM = """You are a lead generation strategist inside cnvrted — a tool that finds LinkedIn posts from businesses actively seeking to hire agencies or buy services.

CONTEXT: Your users are AGENCIES. They want to find clients. They already know what they sell. Your job is to understand their offer precisely and generate laser-targeted search keywords.

QUESTIONING PHILOSOPHY

Ask ONLY what will make the keywords more specific. Every question must earn its place.

The 3 things that matter (in order of importance):
1. WHAT - What specific service? Push beyond vague labels. "Marketing" -> ask if it's paid ads, SEO, content, email. "Development" -> ask if it's mobile, web, AI, backend.
2. WHO - What type of client? Funded startups, e-commerce brands, local businesses, B2B SaaS, enterprise?
3. NICHE - Any industry focus or specialisation? (only ask if not already clear)

Rules:
- Ask ONE question at a time. Never two.
- If their first message already tells you enough (e.g. "paid social ads agency for e-commerce"), generate keywords immediately.
- After 2 solid answers, generate. Do not keep asking.
- Short answers are fine — infer from context and move forward.
- NEVER ask: "What are you looking for?" or "How can I help?" — you already know they want clients.
- Sound like a sharp colleague, not a form.

KEYWORD PHILOSOPHY

Each keyword mimics a real LinkedIn post from a business owner asking their network for a recommendation. When someone posts this, they are actively in-market and ready to hire.

Generate exactly 6 keywords. Rules:
- Every keyword MUST open with a buyer-intent phrase
- Be specific — include the service type AND the client context
- Sound like something a real person would actually post on LinkedIn

Buyer-intent openers to use:
"can anyone recommend" / "looking for a good" / "we need a" / "anyone used a good" / "who do you recommend for" / "need help finding"

BAD (too vague — returns thought leaders and sellers):
- "looking for a marketing agency"
- "need a developer"
- "recommend a designer"

GOOD (specific — returns real in-market buyers):
- "can anyone recommend a Facebook ads agency for Shopify brands"
- "looking for a good video editor for YouTube channel"
- "we need a React developer for our SaaS product"
- "anyone used a good SEO agency for B2B SaaS"
- "who do you recommend for email marketing automation ecommerce"
- "need help finding a brand designer for funded startup"

OUTPUT FORMAT

ALWAYS return valid JSON. Nothing else — no preamble, no explanation, no markdown.

{
  "message": "your response to the user",
  "type": "question" | "ready",
  "keywords": [],
  "domain": ""
}

type="question" -> still gathering context (keywords=[], domain="")
type="ready" -> you have enough — populate all 6 keywords and set domain (specific label e.g. "Paid Social Ads", "React Development", "YouTube Video Editing", "Email Marketing")"""


# ── Models ────────────────────────────────────────────────────────────────────

class HistoryMsg(BaseModel):
    role: str   # "user" or "ai"
    text: str


class ChatMessageRequest(BaseModel):
    message: str
    history: Optional[List[HistoryMsg]] = []
    user_id: Optional[str] = None


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/message")
def chat_message(req: ChatMessageRequest):
    client = _get_client()
    message = req.message.strip()

    # ── Step 1: Haiku classifies intent (cheap + fast) ───────────────
    try:
        clf = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=HAIKU_CLASSIFIER,
            messages=[{"role": "user", "content": message}],
        )
        raw_clf = clf.content[0].text.strip()
        print(f"[Chat] Haiku raw: {raw_clf[:200]}")
        classified = _extract_json(raw_clf)
        print(f"[Chat] Haiku classified: {classified}")
    except Exception as e:
        print(f"[Chat] Haiku error: {e}")
        classified = {"intent": "search"}

    if classified.get("intent") == "casual":
        reply = classified.get("response") or "Hey! What does your agency do? Tell me and I'll find the right buyers for you."
        print(f"[Chat] Casual reply: {reply[:100]}")
        return {
            "message": reply,
            "type": "chat",
            "keywords": [],
            "domain": "",
        }

    # ── Step 2: Sonnet manages Q&A and generates keywords ────────────
    # Strip leading AI messages (greeting/casual) — Sonnet only sees search conversation
    raw_history = list(req.history or [])
    while raw_history and raw_history[0].role != "user":
        raw_history = raw_history[1:]

    history_msgs = []
    for msg in raw_history:
        role = "user" if msg.role == "user" else "assistant"
        history_msgs.append({"role": role, "content": msg.text})

    # Expand single-word first message so Sonnet has proper context
    first_search_msg = message
    if not raw_history and len(message.split()) <= 2:
        first_search_msg = f"I'm looking for {message}"
    history_msgs.append({"role": "user", "content": first_search_msg})

    # Anthropic requires strictly alternating roles — merge consecutive same-role msgs
    cleaned: list = []
    for m in history_msgs:
        if cleaned and cleaned[-1]["role"] == m["role"]:
            cleaned[-1]["content"] += "\n" + m["content"]
        else:
            cleaned.append(dict(m))

    try:
        print(f"[Chat] Sonnet messages ({len(cleaned)}): {[m['role'] for m in cleaned]}")
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=SONNET_SYSTEM,
            messages=cleaned,
        )
        raw_text = resp.content[0].text.strip()
        print(f"[Chat] Sonnet raw: {raw_text[:200]}")
        result = _extract_json(raw_text)

        # If JSON extraction failed, use Sonnet's raw text rather than a confusing fallback
        if not result:
            fallback = raw_text[:300] if raw_text else "What does your agency specialise in? I'll find the right buyers for you."
            return {
                "message": fallback,
                "type": "question",
                "keywords": [],
                "domain": "",
            }

        msg = result.get("message") or "What does your agency specialise in? I'll find the right buyers for you."
        return {
            "message": msg,
            "type": result.get("type", "question"),
            "keywords": result.get("keywords", []),
            "domain": result.get("domain", ""),
        }
    except Exception:
        traceback.print_exc()
        return {
            "message": "Something went wrong — try again.",
            "type": "chat",
            "keywords": [],
            "domain": "",
        }


# Keep old route for any existing integrations
@router.post("/")
def chat_legacy(req: ChatMessageRequest):
    return chat_message(req)
