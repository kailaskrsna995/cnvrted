import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post
from typing import Optional, List

KEYWORDS = {
    "AI Automation": [
        "AI automation", "workflow automation", "AI integration"
    ],
    "Marketing": [
        "marketing agency", "paid ads", "social media help"
    ]
}

APIFY_ACTOR = "supreme_coder~linkedin-post"

def generate_lead_id(url: str, text: str, author: str) -> str:
    raw = f"{url}{text[:100]}{author}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

def build_search_url(keyword: str) -> str:
    from urllib.parse import quote
    return f"https://www.linkedin.com/search/results/content/?datePosted=%22past-24h%22&keywords={quote(keyword)}&origin=FACETED_SEARCH"

async def fetch_apify_results(client: httpx.AsyncClient, keyword: str) -> list:
    # Step 1: start run
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs",
        params={"token": APIFY_API_TOKEN},
        json={"urls": [build_search_url(keyword)], "limitPerSource": 20, "deepScrape": True, "rawData": False}
    )
    if run_resp.status_code not in (200, 201):
        print(f"[Apify] Failed to start run for '{keyword}': {run_resp.text[:200]}")
        return []

    run_id = run_resp.json()["data"]["id"]
    print(f"[Apify] Run started for '{keyword}' run_id={run_id}")

    # Step 2: poll until finished
    for _ in range(24):
        await asyncio.sleep(5)
        status_resp = await client.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_API_TOKEN}
        )
        status = status_resp.json()["data"]["status"]
        print(f"[Apify] '{keyword}' status={status}")
        if status in ("SUCCEEDED", "FAILED", "ABORTED"):
            break

    if status != "SUCCEEDED":
        print(f"[Apify] Run did not succeed for '{keyword}'")
        return []

    # Step 3: fetch dataset from completed run (not initial response)
    run_data_resp = await client.get(
        f"https://api.apify.com/v2/actor-runs/{run_id}",
        params={"token": APIFY_API_TOKEN}
    )
    dataset_id = run_data_resp.json()["data"]["defaultDatasetId"]
    items_resp = await client.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items",
        params={"token": APIFY_API_TOKEN}
    )
    print(f"[Apify] dataset={dataset_id} items_status={items_resp.status_code} count={len(items_resp.json()) if items_resp.status_code == 200 else 'err'}")
    return items_resp.json() if items_resp.status_code == 200 else []

# Posts containing these phrases are almost never buyers — skip before LLM
JOB_SEEKER_SIGNALS = [
    "open to work", "open to opportunities", "looking for a job",
    "seeking a role", "hire me", "my resume", "i am available",
    "i'm available", "job search", "actively looking",
]

# Posts must contain at least one of these to be worth scoring
BUYING_SIGNALS = [
    "looking for", "need a", "need an", "we need", "searching for",
    "recommend", "anyone know", "help with", "seeking a vendor",
    "seeking a partner", "looking to hire", "want to hire",
    "budget", "agency", "contractor", "outsource", "freelancer",
    "platform", "tool", "solution", "service provider",
]


def _is_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if ord(c) < 128) / len(letters) > 0.8


def _has_buying_signal(text: str) -> bool:
    lower = text.lower()
    if any(sig in lower for sig in JOB_SEEKER_SIGNALS):
        return False
    return any(sig in lower for sig in BUYING_SIGNALS)


def _process_posts(posts: list, category: str, user_id: Optional[str]) -> list:
    results = []
    for post in posts:
        try:
            text = post.get("text", "")
            if not text or len(text) < 50:
                continue
            if not _is_english(text):
                print(f"[Filter] Non-English: {text[:60]}")
                continue
            if not _has_buying_signal(text):
                print(f"[Filter] No buying signal: {text[:60]}")
                continue
            author_data = post.get("author", {})
            first = author_data.get("firstName", "")
            last = author_data.get("lastName", "")
            author = f"{first} {last}".strip()
            if not author:
                continue
            occupation = author_data.get("occupation", "")
            profile_id = author_data.get("publicId", "")
            url = post.get("url", "")

            scored = score_post(text, category_hint=category)
            if not scored.get("qualified"):
                print(f"[Filter] Discarded — score={scored.get('intent_score')} text={text[:60]}")
                continue
            # Force category to match searched domain so leads stay in the right feed
            if category and category != "Custom":
                scored["category"] = category

            lead_id = generate_lead_id(url, text, author)
            lead = {
                "lead_id": lead_id,
                "platform": "linkedin",
                "author": author,
                "profession": occupation,
                "company": "",
                "post_text": text,
                "category": scored["category"],
                "intent_score": scored["intent_score"],
                "urgency": scored["urgency"],
                "qualified": scored["qualified"],
                "exact_need": scored.get("exact_need", ""),
                "domain": scored.get("domain", ""),
                "contact_email": scored.get("contact_email", ""),
                "contact_phone": scored.get("contact_phone", ""),
                "contact_linkedin": f"https://www.linkedin.com/in/{profile_id}" if profile_id else "",
                "source_url": url,
                "posted_at": None,
                "user_id": user_id,
            }
            supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
            results.append(lead)
            print(f"[Saved] {author} | score={scored['intent_score']} | {text[:60]}")
        except Exception as e:
            print(f"[Error] processing post: {e}")
    return results


async def run_ingestion(
    custom_keywords: Optional[List[str]] = None,
    domain: Optional[str] = None,
    user_id: Optional[str] = None
):
    if custom_keywords:
        keyword_map = [(domain or "Custom", kw) for kw in custom_keywords]
    else:
        keyword_map = [(cat, kw) for cat, kws in KEYWORDS.items() for kw in kws]

    results = []
    async with httpx.AsyncClient(timeout=300) as client:
        # All keywords fire in parallel — cuts 3-4 min sequential to ~40s
        tasks = [fetch_apify_results(client, kw) for _, kw in keyword_map]
        all_posts = await asyncio.gather(*tasks, return_exceptions=True)

        for (category, keyword), posts in zip(keyword_map, all_posts):
            if isinstance(posts, Exception):
                print(f"[Error] keyword='{keyword}': {posts}")
                continue
            print(f"[Apify] '{keyword}' returned {len(posts)} posts")
            results.extend(_process_posts(posts, category, user_id))

    return results
