import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post

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

async def run_ingestion():
    results = []
    async with httpx.AsyncClient(timeout=300) as client:
        for category, keywords in KEYWORDS.items():
            for keyword in keywords:
                try:
                    posts = await fetch_apify_results(client, keyword)
                    print(f"[Apify] '{keyword}' returned {len(posts)} posts")

                    for post in posts:
                        text = post.get("text", "")
                        if not text or len(text) < 30:
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

                        # Pass 1: filter spam with LLM
                        scored = score_post(text)
                        if not scored.get("qualified"):
                            print(f"[Filter] Discarded — score={scored.get('intent_score')} text={text[:60]}")
                            continue

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
                        }
                        supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
                        results.append(lead)
                        print(f"[Saved] {author} | score={scored['intent_score']} | {text[:60]}")

                except Exception as e:
                    print(f"[Error] keyword='{keyword}': {e}")
    return results
