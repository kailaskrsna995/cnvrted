import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post
from typing import Optional, List

KEYWORDS = {
    "AI Automation": [
        "recommend chatbot developer",
        "automate our workflow help",
        "looking for developer automate",
        "anyone built automation for",
    ],
    "Marketing": [
        "recommend paid ads agency",
        "our ads not performing",
        "looking for Facebook ads help",
        "need marketing agency recommend",
    ]
}

APIFY_ACTOR = "supreme_coder~linkedin-post"
REDDIT_ACTOR = "automation-lab~reddit-scraper"

REDDIT_SUBREDDITS = [
    "entrepreneur", "smallbusiness", "startups",
    "forhire", "SaaS", "digital_marketing", "agencies",
]

def generate_lead_id(url: str, text: str, author: str) -> str:
    raw = f"{url}{text[:100]}{author}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

def build_search_url(keyword: str) -> str:
    from urllib.parse import quote
    # TODO: change past-week back to past-24h for production
    return f"https://www.linkedin.com/search/results/content/?datePosted=%22past-week%22&keywords={quote(keyword)}&origin=FACETED_SEARCH"

async def fetch_apify_results(client: httpx.AsyncClient, keyword: str) -> list:
    # Step 1: start run
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs",
        params={"token": APIFY_API_TOKEN},
        json={"urls": [build_search_url(keyword)], "limitPerSource": 15, "deepScrape": True, "rawData": False}
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

# Sellers promoting their own services — not buyers
SELLER_SIGNALS = [
    "my agency", "our agency", "i built this", "i created this",
    "we specialize in", "i offer", "dm me", "reach out to me",
    "check out my", "here's how i", "i helped a client",
    "book a call", "schedule a call", "free consultation", "link in bio",
    "i specialize in", "our team offers",
]

# Posts must contain at least one of these to be worth scoring
BUYING_SIGNALS = [
    "looking for", "need a", "need an", "we need", "searching for",
    "can anyone recommend", "anyone recommend", "anyone know a good",
    "help with", "seeking a vendor", "seeking a partner",
    "looking to hire", "want to hire", "looking to outsource", "need to hire",
    "budget", "agency", "contractor", "outsource", "freelancer", "freelance",
    "service provider", "need help finding", "who do you use",
    # Creative / project-based buying signals
    "recommend someone", "recommend a", "know anyone", "know someone who",
    "hire someone", "find someone", "need someone", "find a good",
    "looking to work with", "open to collaborat", "looking to connect with",
    "shoot", "produce", "edit", "create content", "make a video",
    "production company", "video production", "creative agency",
    "need help with", "require a", "require an",
    # Company hiring signals — growing companies are buyers too
    "we're hiring", "we are hiring", "now hiring", "hiring for",
    "open role", "open position", "join our team", "looking to bring on",
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
    if any(sig in lower for sig in SELLER_SIGNALS):
        return False
    return any(sig in lower for sig in BUYING_SIGNALS)


def _process_posts(posts: list, category: str, user_id: Optional[str]) -> tuple:
    results = []
    total_scanned = 0
    for post in posts:
        total_scanned += 1
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

            # Extract posted_at — Apify actor field name varies
            raw_date = (
                post.get("postedAt") or
                post.get("posted_at") or
                post.get("date") or
                post.get("publishedAt") or
                post.get("createdAt")
            )
            posted_at = None
            if raw_date:
                try:
                    from datetime import datetime as _dt
                    if isinstance(raw_date, (int, float)):
                        posted_at = _dt.utcfromtimestamp(raw_date / 1000).isoformat()
                    else:
                        posted_at = str(raw_date)
                except Exception:
                    posted_at = None

            lead_id = generate_lead_id(url, text, author)
            lead = {
                "lead_id": lead_id,
                "platform": post.get("_platform", "linkedin"),
                "author": author,
                "profession": occupation,
                "company": "",
                "post_text": text,
                "category": scored["category"],
                "intent_score": scored["intent_score"],
                "timeline": scored.get("timeline", "Active"),
                "qualified": scored["qualified"],
                "exact_need": scored.get("exact_need", ""),
                "domain": scored.get("domain", ""),
                "contact_email": scored.get("contact_email", ""),
                "contact_phone": scored.get("contact_phone", ""),
                "contact_linkedin": f"https://www.linkedin.com/in/{profile_id}" if profile_id else "",
                "source_url": url,
                "posted_at": posted_at,
                "user_id": user_id,
                "tokens_used": scored.get("tokens_used", 0),
            }
            supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
            results.append(lead)
            print(f"[Saved] {author} | score={scored['intent_score']} | {text[:60]}")
        except Exception as e:
            print(f"[Error] processing post: {e}")
    return results, total_scanned


async def fetch_reddit_apify_results(client: httpx.AsyncClient, keyword: str) -> list:
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{REDDIT_ACTOR}/runs",
        params={"token": APIFY_API_TOKEN},
        json={
            "searches": [keyword],
            "subreddits": REDDIT_SUBREDDITS,
            "sort": "new",
            "maxItems": 50,
            "maxCommentsPerPost": 0,
        }
    )
    if run_resp.status_code not in (200, 201):
        print(f"[Reddit] Failed to start run for '{keyword}': {run_resp.text[:200]}")
        return []

    run_id = run_resp.json()["data"]["id"]
    print(f"[Reddit] Run started for '{keyword}' run_id={run_id}")

    for _ in range(24):
        await asyncio.sleep(5)
        status_resp = await client.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_API_TOKEN}
        )
        status = status_resp.json()["data"]["status"]
        print(f"[Reddit] '{keyword}' status={status}")
        if status in ("SUCCEEDED", "FAILED", "ABORTED"):
            break

    if status != "SUCCEEDED":
        print(f"[Reddit] Run did not succeed for '{keyword}'")
        return []

    run_data_resp = await client.get(
        f"https://api.apify.com/v2/actor-runs/{run_id}",
        params={"token": APIFY_API_TOKEN}
    )
    dataset_id = run_data_resp.json()["data"]["defaultDatasetId"]
    items_resp = await client.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items",
        params={"token": APIFY_API_TOKEN}
    )
    raw_items = items_resp.json() if items_resp.status_code == 200 else []
    print(f"[Reddit] dataset={dataset_id} count={len(raw_items)}")

    # Normalise Reddit fields to match LinkedIn post shape
    normalised = []
    for item in raw_items:
        normalised.append({
            "text": item.get("title", "") + "\n" + item.get("body", item.get("selftext", "")),
            "author": {
                "firstName": item.get("author", "Reddit User"),
                "lastName": "",
                "occupation": item.get("subreddit", ""),
                "publicId": "",
            },
            "url": f"https://reddit.com{item.get('permalink', '')}",
            "postedAt": item.get("createdAt") or item.get("created_utc"),
            "_platform": "reddit",
        })
    return normalised


async def run_ingestion(
    custom_keywords: Optional[List[str]] = None,
    domain: Optional[str] = None,
    user_id: Optional[str] = None
):
    if custom_keywords:
        keyword_map = [(domain or "Custom", kw) for kw in custom_keywords]
    else:
        keyword_map = [(cat, kw) for cat, kws in KEYWORDS.items() for kw in kws]

    print(f"[Ingestion] Keywords to scan: {[kw for _, kw in keyword_map]}")
    results = []
    total_scanned = 0
    async with httpx.AsyncClient(timeout=300) as client:
        # LinkedIn + Reddit fire in parallel
        linkedin_tasks = [fetch_apify_results(client, kw) for _, kw in keyword_map]
        reddit_tasks = [fetch_reddit_apify_results(client, kw) for _, kw in keyword_map]
        all_results = await asyncio.gather(*linkedin_tasks, *reddit_tasks, return_exceptions=True)

        linkedin_results = all_results[:len(keyword_map)]
        reddit_results = all_results[len(keyword_map):]

        for (category, keyword), posts in zip(keyword_map, linkedin_results):
            if isinstance(posts, Exception):
                print(f"[Error] LinkedIn keyword='{keyword}': {posts}")
                continue
            print(f"[LinkedIn] '{keyword}' returned {len(posts)} posts")
            saved, scanned = _process_posts(posts, category, user_id)
            results.extend(saved)
            total_scanned += scanned

        for (category, keyword), posts in zip(keyword_map, reddit_results):
            if isinstance(posts, Exception):
                print(f"[Error] Reddit keyword='{keyword}': {posts}")
                continue
            print(f"[Reddit] '{keyword}' returned {len(posts)} posts")
            # Mark platform for Reddit posts
            for p in posts:
                p["_platform"] = "reddit"
            saved, scanned = _process_posts(posts, category, user_id)
            results.extend(saved)
            total_scanned += scanned

    total_saved = len(results)
    print(f"[Ingestion] Done — scanned={total_scanned} saved={total_saved} rejected={total_scanned - total_saved}")
    return {"total_scanned": total_scanned, "total_saved": total_saved, "total_rejected": total_scanned - total_saved}
