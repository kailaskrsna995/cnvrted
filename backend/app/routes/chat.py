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


HAIKU_QA_SYSTEM = """You work for cnvrted, a lead generation tool for agencies. Your job is to collect 5 pieces of information about their agency — then hand off to the keyword engine.

THE 5 QUESTIONS (ask in this exact order, one at a time):
Q1 SERVICE    — What specific service does your agency offer?
               If the answer is vague (e.g. "marketing", "development"), ask ONE follow-up: "Is that [option A], [option B], or something else?" Then accept whatever they say.
Q2 CLIENT     — What kind of businesses do you typically work with? (e-commerce brands, SaaS companies, local businesses, B2B, etc.)
Q3 STAGE      — What stage are your ideal clients at? (early-stage startups, funded startups, SMBs, mid-market, enterprise — or a mix)
Q4 PROBLEM    — What's the main thing you help them fix? (e.g. low ad ROI, no content strategy, slow website, poor conversions)
Q5 GEOGRAPHY  — Where are your clients based? (local, US only, UK, Europe, global — any is fine)

RULES:
- Read the conversation history carefully to know which questions have already been answered
- Ask only the NEXT unanswered question — never repeat a question that was already answered
- Accept ALL answers, including short or vague ones ("mix", "all", "startups", "global", "various") — NEVER ask for more detail on an answered question
- Be warm and conversational — one sentence per question, no bullet lists
- When the user's first message already answers Q1 (e.g. "we do paid ads for e-commerce"), count that as answered and ask Q2 next
- After ALL 5 questions are answered, set type="ready"

Return ONLY valid JSON — no extra text, no markdown:
{
  "type": "question" | "ready",
  "message": "your next question or a short 'Got it!' + transition when ready",
  "collected": {
    "service": "",
    "client_type": "",
    "stage": "",
    "problem": "",
    "geography": ""
  }
}

When type="ready": fill every collected field with the user's answer (use "general" for anything not specified).
When type="question": fill only the fields answered so far, leave the rest as empty strings."""


SONNET_KEYWORDS_SYSTEM = """You generate laser-targeted LinkedIn buyer-intent search keywords for a lead generation tool.

Given a complete agency profile, generate exactly 6 keyword phrases that mimic real LinkedIn posts from business owners actively seeking to hire an agency like this one.

KEYWORD RULES:
- Every keyword MUST start with one of these buyer-intent openers:
  "can anyone recommend" / "looking for a good" / "we need a" / "anyone used a good" / "who do you recommend for" / "need help finding" / "looking to hire a"
- Be specific — combine the service type + client context + pain signal where possible
- Sound like something a real founder or marketing manager would post on LinkedIn
- 5-9 words per keyword
- Use all 6 openers (vary them — don't repeat the same opener twice)

BAD (too vague — returns thought leaders and vendors):
- "looking for a marketing agency"
- "need a developer"

GOOD (returns actual in-market buyers):
- "can anyone recommend a Facebook ads agency for Shopify brands"
- "looking for a good video editor for our YouTube channel"
- "we need a React developer for our SaaS product"
- "anyone used a good SEO agency for B2B SaaS companies"
- "who do you recommend for email marketing automation for ecommerce"
- "need help finding a brand designer who works with funded startups"

Return ONLY valid JSON — no preamble, no markdown:
{
  "message": "short excited line — 'Here are your keywords! Ready to scan LinkedIn for buyers.'",
  "domain": "concise service label (e.g. 'Paid Social Ads', 'Content Marketing', 'React Development', 'YouTube Video Editing')",
  "keywords": ["phrase1", "phrase2", "phrase3", "phrase4", "phrase5", "phrase6"]
}"""


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
    "bye", "cya", "cheers", "what", "how",
}

def _clean_history(raw_history: list) -> list:
    """Strip leading AI messages and leading casual exchanges."""
    # Remove leading AI messages
    while raw_history and raw_history[0].role != "user":
        raw_history = raw_history[1:]
    # Remove leading casual user↔AI pairs (e.g. "hey" / "hi there")
    while len(raw_history) >= 2 and raw_history[0].role == "user":
        words = set(raw_history[0].text.lower().strip().split())
        if len(words) <= 3 and words.issubset(CASUAL_WORDS):
            raw_history = raw_history[2:]
        else:
            break
    return raw_history


def _to_anthropic_messages(history: list, current_message: str) -> list:
    """Convert HistoryMsg list + current message to Anthropic API format with alternating roles."""
    msgs = []
    for msg in history:
        role = "user" if msg.role == "user" else "assistant"
        msgs.append({"role": role, "content": msg.text})
    msgs.append({"role": "user", "content": current_message})

    # Merge consecutive same-role messages (Anthropic requires strict alternation)
    cleaned = []
    for m in msgs:
        if cleaned and cleaned[-1]["role"] == m["role"]:
            cleaned[-1]["content"] += "\n" + m["content"]
        else:
            cleaned.append(dict(m))
    return cleaned


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/message")
def chat_message(req: ChatMessageRequest):
    client = _get_client()
    message = req.message.strip()

    # ── Step 1: Haiku classifies intent (casual vs search) ───────────
    try:
        clf = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=200,
            system=HAIKU_CLASSIFIER,
            messages=[{"role": "user", "content": message}],
        )
        raw_clf = clf.content[0].text.strip()
        print(f"[Chat] Classify raw: {raw_clf[:200]}")
        classified = _extract_json(raw_clf)
    except Exception as e:
        print(f"[Chat] Classify error: {e}")
        classified = {"intent": "search"}

    if classified.get("intent") == "casual":
        reply = classified.get("response") or "Hey! What does your agency do? Tell me and I'll find the right buyers for you."
        print(f"[Chat] Casual: {reply[:100]}")
        return {"message": reply, "type": "chat", "keywords": [], "domain": ""}

    # ── Step 2: Haiku runs the 5-question Q&A ────────────────────────
    raw_history = _clean_history(list(req.history or []))

    # Expand single-word first message so Haiku has context
    first_msg = message
    if not raw_history and len(message.split()) <= 2:
        first_msg = f"My agency does {message}"

    messages = _to_anthropic_messages(raw_history, first_msg)

    try:
        print(f"[Chat] Haiku QA turn — {len(messages)} msgs")
        qa = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            system=HAIKU_QA_SYSTEM,
            messages=messages,
        )
        raw_qa = qa.content[0].text.strip()
        print(f"[Chat] Haiku QA raw: {raw_qa[:300]}")
        qa_result = _extract_json(raw_qa)
    except Exception as e:
        print(f"[Chat] Haiku QA error: {e}")
        return {"message": "What does your agency specialise in?", "type": "question", "keywords": [], "domain": ""}

    if not qa_result:
        return {"message": "What does your agency specialise in?", "type": "question", "keywords": [], "domain": ""}

    # ── Step 3: If Haiku has all 5 answers, Sonnet generates keywords ─
    if qa_result.get("type") == "ready":
        collected = qa_result.get("collected", {})
        context_block = (
            f"Service: {collected.get('service', 'general')}\n"
            f"Client type: {collected.get('client_type', 'general')}\n"
            f"Stage/size: {collected.get('stage', 'general')}\n"
            f"Core problem they solve: {collected.get('problem', 'general')}\n"
            f"Geography: {collected.get('geography', 'global')}"
        )
        print(f"[Chat] Sonnet context:\n{context_block}")
        try:
            kw_resp = client.messages.create(
                model="claude-sonnet-4-6",
                max_tokens=512,
                system=SONNET_KEYWORDS_SYSTEM,
                messages=[{"role": "user", "content": context_block}],
            )
            raw_kw = kw_resp.content[0].text.strip()
            print(f"[Chat] Sonnet keywords raw: {raw_kw[:300]}")
            kw_result = _extract_json(raw_kw)
            if kw_result and kw_result.get("keywords"):
                return {
                    "message": kw_result.get("message", "Here are your keywords — ready to scan!"),
                    "type": "ready",
                    "keywords": kw_result.get("keywords", []),
                    "domain": kw_result.get("domain", ""),
                }
        except Exception:
            traceback.print_exc()
        # Sonnet failed — ask user to try again
        return {"message": "Almost there — something went wrong generating keywords. Try sending your last answer again.", "type": "question", "keywords": [], "domain": ""}

    # Still in Q&A phase — return Haiku's next question
    msg = qa_result.get("message") or "Tell me more about your agency."
    return {"message": msg, "type": "question", "keywords": [], "domain": ""}


# Keep old route for any existing integrations
@router.post("/")
def chat_legacy(req: ChatMessageRequest):
    return chat_message(req)
