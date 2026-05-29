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
        pass
    # Second attempt: strip control characters that break json.loads
    try:
        import re
        cleaned = re.sub(r'[\x00-\x08\x0b\x0c\x0e-\x1f]', '', raw[start:end + 1])
        return json.loads(cleaned)
    except Exception:
        return {}


def _clean_message(text: str) -> str:
    """Strip any JSON that leaked into a message string (e.g. Sonnet added
    a preamble before the JSON block, causing json.loads to fail and the
    whole raw output to be returned as the message)."""
    if not text:
        return text
    # Cut at first bare newline-brace sequence — that's where JSON starts
    for marker in ('\n{', '\n```'):
        idx = text.find(marker)
        if idx != -1:
            text = text[:idx]
    return text.strip()


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

GENERATE IMMEDIATELY (no questions) if you know:
- What they sell (service type) — even roughly, AND
- Any hint of who they serve (audience, platform, niche, or industry)

Examples that should trigger IMMEDIATE generation — no questions:
→ "I run an AI film company for streaming platforms" → generate now
→ "We do video production for brands" → generate now
→ "Social media agency for ecommerce" → generate now
→ "We help SaaS companies with paid ads" → generate now

"yes" or "both" answers: if the user replies "yes" or "both" to a clarification — accept ALL options mentioned and generate immediately. Never ask a follow-up after "yes".

Short/vague answers ("mix", "all", "various") → accept them, infer sensibly, generate.

Maximum 2 questions total before generating — never ask a 3rd question under any circumstances.

Put your "Got it — [X] for [Y]" confirmation inside the "message" field of the type="ready" response, not as a separate question.

═══ KEYWORD PHILOSOPHY ═══

Keywords are SHORT search phrases entered into Reddit, Twitter, and LinkedIn to surface posts from BUYERS who need to hire an agency. They are matched against real posts, so they must be short enough to actually appear in someone's post — NOT full sentences.

THE #1 RULE: SHORT. Each keyword is 3–6 words. No 10-word sentences. No one posts a 12-word sentence verbatim, so long phrases match nothing. Extract the core.
✗ BAD (too long): "can anyone recommend a content creation agency for social media and paid ads"
✓ GOOD (core): "content agency recommendation"

THE #2 RULE: DIVERSITY. Do NOT make all 6 keywords "looking for a vendor". Catch buyers at different stages. Generate EXACTLY 2 from each bucket below:

BUCKET A — PAIN (2 keywords): the buyer venting a problem, before they've started shopping. These catch buyers earliest.
Pain language: "drowning in", "can't keep up with", "struggling with", "running out of", "ROAS dropping", "inconsistent", "stretched thin", "falling behind on"
✓ "drowning in content requests"
✓ "social media is inconsistent"
✓ "running out of ad creatives"
✓ "can't keep up with content"

BUCKET B — SEEKING (2 keywords): the buyer actively hunting for a vendor.
Seeking language: "looking for", "need a", "recommend a", "who do you use for", "hiring a", "outsource"
✓ "looking for content agency"
✓ "need a video ad partner"
✓ "ugc agency recommendation"
✓ "outsource paid social"

BUCKET C — TRIGGER (2 keywords): an event that signals fresh budget or new need.
Trigger language: "just raised", "scaling our", "ramping up", "just hired a head of", "launching", "expanding into", "doubling down on"
✓ "scaling our paid social"
✓ "ramping up content production"
✓ "just hired head of marketing"
✓ "launching our DTC brand"

RULES — NON-NEGOTIABLE:
- 3–6 words each. If you write more than 6 words, cut it down.
- Use the buyer's language, not agency language: "ad creatives", "UGC", "video ads", "ROAS", "paid social" — not "content production" or "visual storytelling".
- Include ONE context word where natural: "ecommerce", "DTC", "Meta ads", "TikTok", "B2B SaaS", "content", "ads".
- All 6 different. 2 from PAIN, 2 from SEEKING, 2 from TRIGGER.
- No question marks, no "can anyone" fluff padding — keep the core nouns/verbs only.

═══ CASUAL MESSAGES ═══

If the message is pure small talk ("hey", "hi", "thanks", "lol") — respond warmly in 1-2 sentences and ask what their agency does. No JSON needed... wait, still return JSON:
type="chat", keywords=[], domain=""

═══ OUTPUT FORMAT ═══

ALWAYS return valid JSON only. No preamble. No markdown. No extra text.
NEVER wrap your response in ```json``` or any code block. Return the raw JSON object directly — starting with { and ending with }.
The "message" field must contain ONLY plain conversational text — never JSON, curly braces, or code blocks inside the message value.

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
            # Non-JSON or malformed JSON — extract just the text before any JSON block
            fallback = _clean_message(raw[:500]) if raw else ""
            return {
                "message": fallback or "What does your agency specialise in?",
                "type": "question",
                "keywords": [],
                "domain": "",
            }

        return {
            "message": _clean_message(result.get("message") or "What does your agency specialise in?"),
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
