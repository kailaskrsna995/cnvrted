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


# ── Prompt ────────────────────────────────────────────────────────────────────

SONNET_SYSTEM = """You are the AI inside cnvrted — a lead generation tool that finds LinkedIn posts from businesses actively seeking to hire agencies.

Your users ARE agencies. They are NOT looking for agencies — they ARE agencies looking for clients.

═══ YOUR JOB ═══

Understand their agency well enough to generate 6 LinkedIn search phrases that surface real in-market buyers right now.

═══ CONVERSATION FLOW ═══

STEP 1 — PARSE what they told you first.
Extract everything you can from their opening message:
- Service: what specific thing they sell (e.g. Instagram content, Facebook ads, web dev, SEO)
- Client: who they work with (e.g. e-commerce brands, SaaS startups, local businesses)
- Niche: any industry (e.g. fintech, health, fashion — or general)
- Stage: startup, SMB, funded, enterprise, mix
- Problem: what pain they solve (e.g. low engagement, no online presence, poor ad ROI)

STEP 2 — ASK only what you still need. Every question must be:
- Specific to what they already told you (not generic "what do you do?")
- One question at a time
- Conversational, not clinical

Good dynamic questions (based on their answer):
→ They said "social media" → "Which platforms — Instagram and TikTok, or LinkedIn too?"
→ They said "startups" → "Are we talking bootstrapped founders or funded Series A+ companies?"
→ They said "content" → "Is that written content, video, or graphic design?"
→ They said "marketing" → "Paid ads, organic content, SEO, or something else?"
→ They said "AI video" or "AI film" → "Are your clients brands wanting AI ads, or studios/creators wanting AI production tools?"

Bad questions to NEVER ask:
✗ "What do you do?" (if they already told you)
✗ "How can I help?" (you already know)
✗ "What are you looking for?" (they want clients)
✗ Any repeat of a question already answered

STEP 3 — GENERATE after enough context. Rules:
- If their first message gives you 3+ clear dimensions, generate immediately — no questions
- Otherwise ask until you have: service type + client type + at least one more dimension
- Maximum 4 questions total — never ask a 5th
- Short/vague answers ("mix", "all", "various") → accept them, infer sensibly, move on
- Before generating, confirm your understanding in one sentence: "Got it — [X] for [Y], focused on [Z]."

═══ KEYWORD PHILOSOPHY ═══

Keywords must read like a real post from a BUSINESS OWNER asking their network for a recommendation.
They are NOT descriptions of your agency. They capture the buyer's voice.

The buyer is a founder, head of marketing, or CEO who needs to hire an agency like yours.
They post: "Hey network — can anyone recommend a good [service] for [their situation]?"

KEYWORD STRATEGY — generate 2 types, 3 of each:

TYPE 1 — SHORT (3-5 words, high match rate on LinkedIn search):
These are fragments that appear inside real buyer posts. Short = broader match.
Examples: "recommend video editing agency" / "need video agency" / "outsource video editing" / "looking for video agency" / "need help video content"

TYPE 2 — SPECIFIC (6-9 words, higher quality matches):
Full buyer-intent sentences that mimic how a real founder would post.
Openers: "can anyone recommend" / "looking for a good" / "we need a" / "anyone used a good" / "who do you recommend for" / "need help finding"
Examples: "can anyone recommend a video editing agency for startups" / "looking for a good video production agency for our brand"

RULES FOR ALL KEYWORDS:
- Always include "agency", "freelancer", or "service" — NEVER just the role alone ("video editor" alone matches job listings)
- Short keywords: 3-5 words, no filler
- Specific keywords: include client context (who they are, their stage)
- All 6 must be different openers/structures

═══ CASUAL MESSAGES ═══

If the message is pure small talk ("hey", "hi", "thanks", "lol") — respond warmly in 1-2 sentences and ask what their agency does. No JSON needed... wait, still return JSON:
type="chat", keywords=[], domain=""

═══ OUTPUT FORMAT ═══

ALWAYS return valid JSON only. No preamble. No markdown. No extra text.

{
  "message": "your response to the user",
  "type": "chat" | "question" | "ready",
  "keywords": [],
  "domain": ""
}

type="chat"     → casual/small talk reply (keywords=[], domain="")
type="question" → asking for more info (keywords=[], domain="")
type="ready"    → all 6 keywords generated, domain set (e.g. "Instagram Content Marketing", "Paid Social Ads", "SaaS SEO")"""


# ── Models ────────────────────────────────────────────────────────────────────

class HistoryMsg(BaseModel):
    role: str   # "user" or "ai"
    text: str


class ChatMessageRequest(BaseModel):
    message: str
    history: Optional[List[HistoryMsg]] = []
    user_id: Optional[str] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

CASUAL_WORDS = {
    "hey", "hi", "hello", "yo", "sup", "hiya", "howdy",
    "thanks", "thx", "thank", "lol", "lmao", "cool",
    "ok", "okay", "great", "nice", "haha", "hehe",
    "bye", "cya", "cheers",
}

def _clean_history(raw: list) -> list:
    """Remove leading AI messages and leading casual-only exchanges."""
    while raw and raw[0].role != "user":
        raw = raw[1:]
    while len(raw) >= 2 and raw[0].role == "user":
        words = set(raw[0].text.lower().strip().split())
        if len(words) <= 3 and words.issubset(CASUAL_WORDS):
            raw = raw[2:]
        else:
            break
    return raw


def _build_messages(history: list, current: str) -> list:
    """Build strictly alternating Anthropic messages list."""
    msgs = [
        {"role": "user" if m.role == "user" else "assistant", "content": m.text}
        for m in history
    ]
    msgs.append({"role": "user", "content": current})
    # Merge consecutive same-role messages
    merged = []
    for m in msgs:
        if merged and merged[-1]["role"] == m["role"]:
            merged[-1]["content"] += "\n" + m["content"]
        else:
            merged.append(dict(m))
    return merged


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/message")
def chat_message(req: ChatMessageRequest):
    client = _get_client()
    message = req.message.strip()

    history = _clean_history(list(req.history or []))

    # Expand single-word opener so Sonnet has context on first search message
    first_msg = message
    if not history and len(message.split()) <= 2 and message.lower() not in CASUAL_WORDS:
        first_msg = f"My agency does {message}"

    messages = _build_messages(history, first_msg)

    try:
        print(f"[Chat] Sonnet — {len(messages)} msgs, last: '{message[:60]}'")
        resp = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            system=SONNET_SYSTEM,
            messages=messages,
        )
        raw = resp.content[0].text.strip()
        print(f"[Chat] Sonnet raw: {raw[:300]}")
        result = _extract_json(raw)

        if not result:
            # Non-JSON response — use raw text as the message
            return {
                "message": raw[:400] if raw else "What does your agency specialise in?",
                "type": "question",
                "keywords": [],
                "domain": "",
            }

        return {
            "message": result.get("message") or "What does your agency specialise in?",
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
