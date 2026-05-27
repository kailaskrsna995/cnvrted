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

HAIKU_CLASSIFIER = """Classify this message for a B2B lead generation assistant.

casual = greetings, thanks, questions about the tool, off-topic, anything NOT about finding business leads
search = user mentions a service, industry, client type, or what they want leads for

If casual, write a SHORT warm reply (1-2 sentences). Mention you find B2B buyer leads if natural.

Return JSON only:
{"intent": "casual" | "search", "response": "friendly reply if casual, else empty string"}"""


SONNET_SYSTEM = """You are the search assistant inside cnvrted — a B2B lead intelligence tool that finds LinkedIn posts from businesses actively looking to hire or buy services.

YOUR GOAL: understand what the user needs through conversation, then generate precise LinkedIn search keywords.

CONVERSATION RULES:
- Ask ONE short question at a time
- If the user gives a short answer (even a single word like "editor" or "developer"), treat it as context and ask a follow-up — NEVER ask "what are you looking for?" again if they already answered
- You need: (1) what type of service/person they need, (2) what it's for, (3) any specifics (platform, industry, etc.)
- After 2-3 meaningful exchanges, generate keywords — don't over-ask
- CRITICAL: You MUST always return valid JSON. Never return plain text.

KEYWORD FORMAT — exactly 6 keywords, each opening with a buyer-intent phrase:
- "can anyone recommend [service]"
- "looking for a good [provider]"
- "we need a [role] for [task]"
- "anyone used a good [type] for [use case]"
- "who do you recommend for [need]"
- "need help finding [specialist]"

ALWAYS return this exact JSON structure — nothing else, no extra text:
{
  "message": "your reply",
  "type": "question" | "ready",
  "keywords": [],
  "domain": ""
}

type="question" → still gathering info (keywords and domain stay empty)
type="ready" → enough context gathered — fill all 6 keywords and set domain (e.g. "Video Editing", "AI Automation", "Web Development")"""


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
            max_tokens=150,
            system=HAIKU_CLASSIFIER,
            messages=[{"role": "user", "content": message}],
        )
        classified = _extract_json(clf.content[0].text.strip())
    except Exception:
        classified = {"intent": "search"}

    if classified.get("intent") == "casual":
        return {
            "message": classified.get("response") or "Hey! Tell me what kind of leads you're after and I'll get to work.",
            "type": "chat",
            "keywords": [],
            "domain": "",
        }

    # ── Step 2: Sonnet manages Q&A and generates keywords ────────────
    # Build clean history for Sonnet — strip leading AI messages (greeting/casual)
    # so Sonnet only sees the actual search conversation
    raw_history = list(req.history or [])

    # Drop everything before the first user message to avoid greeting/casual noise
    while raw_history and raw_history[0].role != "user":
        raw_history = raw_history[1:]

    history_msgs = []
    for msg in raw_history:
        role = "user" if msg.role == "user" else "assistant"
        history_msgs.append({"role": role, "content": msg.text})
    # If this is the very first search message and it's a single word,
    # expand it slightly so Sonnet has something to work with
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
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=512,
            system=SONNET_SYSTEM,
            messages=cleaned,
        )
        raw_text = resp.content[0].text.strip()
        result = _extract_json(raw_text)

        # If JSON extraction failed, Sonnet returned plain text — wrap it
        if not result:
            return {
                "message": raw_text[:300] if raw_text else "Can you tell me more about what you need?",
                "type": "question",
                "keywords": [],
                "domain": "",
            }

        return {
            "message": result.get("message", "Can you tell me more about what you need?"),
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
