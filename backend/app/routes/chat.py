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

YOUR GOAL: through natural conversation, understand what the user sells and who their ideal client is, then generate precise LinkedIn search keywords.

CONVERSATION RULES:
- Ask ONE short question at a time — never two at once
- Be concise and conversational, not robotic
- You need to understand: (1) what they offer, (2) who their target client is, (3) the client's core pain point
- After 3-4 exchanges where you have that context, generate keywords immediately — don't keep asking

KEYWORD FORMAT — generate exactly 6 keywords. Each MUST open with a buyer-intent phrase so LinkedIn surfaces posts from people asking for help, not promoting services:
✓ "can anyone recommend [service]"
✓ "looking for a good [provider type]"
✓ "we need a [role/service] for [problem]"
✓ "anyone used a good [agency/freelancer] for [task]"
✓ "who do you recommend for [specific need]"
✓ "need help finding [specialist]"

ALWAYS return valid JSON and nothing else:
{
  "message": "your reply to the user",
  "type": "question" | "ready",
  "keywords": [],
  "domain": ""
}

type="question" → still building context, leave keywords and domain empty
type="ready" → you have enough info; populate all 6 keywords and set domain (e.g. "Video Production", "AI Automation", "Web Development")"""


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
    # Build multi-turn history for Sonnet
    history_msgs = []
    for msg in (req.history or []):
        role = "user" if msg.role == "user" else "assistant"
        history_msgs.append({"role": role, "content": msg.text})
    history_msgs.append({"role": "user", "content": message})

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
        result = _extract_json(resp.content[0].text.strip())
        return {
            "message": result.get("message", "What are you looking for?"),
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
