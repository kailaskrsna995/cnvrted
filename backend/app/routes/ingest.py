from fastapi import APIRouter, BackgroundTasks, Body, Query
from pydantic import BaseModel
from typing import Optional, List
from app.ingestion import run_ingestion, fetch_apify_results, fetch_twitter_results, fetch_reddit_results
from app.database import supabase
from app.scorer import score_post
import hashlib
import httpx
from datetime import datetime, timezone, timedelta
import random

router = APIRouter(prefix="/ingest", tags=["ingest"])

# Global lock — prevents concurrent scans from stacking up
_scan_in_progress = False
# Per-user scan stats, keyed by user_id. Without this, a new user sees the
# previous scanner's "Posts Scanned" count leak onto their dashboard.
_last_scan_stats: dict = {}
_EMPTY_STATS = {"total_scanned": 0, "total_rejected": 0, "total_saved": 0}


class IngestRequest(BaseModel):
    user_id: Optional[str] = None
    keywords: Optional[List[str]] = None
    domain: Optional[str] = None
    service: Optional[str] = None   # what the user sells — passed from the chat session

MOCK_POSTS = [
    {"author": "Sarah Chen", "company": "TechFlow Inc", "text": "Our support team is drowning in repetitive tickets. We desperately need AI automation to handle FAQs. Any recommendations for tools or agencies that specialize in this?", "category": "AI Automation"},
    {"author": "James Okafor", "company": "Retail Ops Co", "text": "We're looking to automate our entire customer onboarding workflow. Repetitive tasks are killing productivity. Need help with AI integration ASAP.", "category": "AI Automation"},
    {"author": "Priya Sharma", "company": "GrowthBase", "text": "Need a chatbot that can handle 80% of our support queries autonomously. Budget approved, looking for the right partner to build this.", "category": "AI Automation"},
    {"author": "Marcus Webb", "company": "Fintech Startup", "text": "Our Instagram engagement dropped 60% this month. Ads are not performing either. We need a serious marketing agency to fix our social strategy.", "category": "Marketing"},
    {"author": "Lucia Torres", "company": "E-commerce Brand", "text": "Looking for a paid ads expert. Our Facebook and Google campaigns are hemorrhaging money with zero ROI. Need urgent help.", "category": "Marketing"},
    {"author": "David Kim", "company": "SaaS Founders Club", "text": "We need workflow automation badly. Our team spends 4 hours daily on tasks that should be automated. Looking for AI integration specialists.", "category": "AI Automation"},
    {"author": "Amara Johnson", "company": "D2C Brand", "text": "Need social media help — we have great products but zero online presence. Looking for someone to build our content strategy from scratch.", "category": "Marketing"},
    {"author": "Tom Brecker", "company": "Logistics Co", "text": "Automate support is the goal this quarter. We process 500+ tickets daily and need AI to cut that to under 100. Who has done this before?", "category": "AI Automation"},
]

@router.get("/status/")
def scan_status(user_id: Optional[str] = Query(default=None)):
    stats = _last_scan_stats.get(user_id or "", _EMPTY_STATS)
    return {"scanning": _scan_in_progress, **stats}

@router.post("/stop/")
def stop_scan():
    global _scan_in_progress
    _scan_in_progress = False
    return {"status": "stopped"}

@router.post("/seed")
async def seed_mock_leads():
    inserted = []
    for i, post in enumerate(MOCK_POSTS):
        scored = score_post(post["text"])
        lead_id = hashlib.sha256(f"mock-{i}-{post['author']}".encode()).hexdigest()[:32]
        mins_ago = random.randint(2, 120)
        lead = {
            "lead_id": lead_id,
            "platform": "linkedin",
            "author": post["author"],
            "company": post["company"],
            "post_text": post["text"],
            "category": scored.get("category", post["category"]),
            "intent_score": scored.get("intent_score", 80),
            "timeline": scored.get("timeline", "Active"),
            "qualified": True,
            "source_url": f"https://linkedin.com/mock/{lead_id}",
            "posted_at": (datetime.utcnow() - timedelta(minutes=mins_ago)).isoformat(),
        }
        supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
        inserted.append(lead)
    return {"seeded": len(inserted)}

@router.get("/apify-check/")
async def apify_check(
    keyword: str = Query(default="can anyone recommend marketing agency"),
):
    """Low-level Apify diagnostic. Shows run start status, poll status, and raw item count.
    Hit this to see exactly why LinkedIn scraping is returning 0 posts."""
    from app.config import APIFY_API_TOKEN
    from app.ingestion import build_search_url, APIFY_ACTOR
    from urllib.parse import quote

    steps = []
    token_present = bool(APIFY_API_TOKEN)
    steps.append({"step": "token_check", "token_present": token_present, "token_prefix": APIFY_API_TOKEN[:8] + "..." if token_present else None})

    if not token_present:
        return {"error": "APIFY_API_TOKEN not set", "steps": steps}

    url = build_search_url(keyword)
    steps.append({"step": "search_url", "url": url})

    async with httpx.AsyncClient(timeout=300) as client:
        # Check Apify account status / credits
        try:
            me_resp = await client.get(
                "https://api.apify.com/v2/users/me",
                params={"token": APIFY_API_TOKEN},
                timeout=10,
            )
            me_data = me_resp.json()
            plan = me_data.get("data", {}).get("plan", {})
            usage = me_data.get("data", {}).get("limits", {})
            steps.append({
                "step": "account",
                "status_code": me_resp.status_code,
                "plan_id": plan.get("id"),
                "monthly_usage_usd": usage.get("monthlyUsageCreditsUsdLimit"),
            })
        except Exception as e:
            steps.append({"step": "account", "error": str(e)})

        # Try to start a run
        payload = {"urls": [url], "limitPerSource": 5, "deepScrape": True, "rawData": False}
        try:
            run_resp = await client.post(
                f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs",
                params={"token": APIFY_API_TOKEN},
                json=payload,
                timeout=30,
            )
            steps.append({
                "step": "start_run",
                "status_code": run_resp.status_code,
                "body": run_resp.json() if run_resp.status_code in (200, 201) else run_resp.text[:400],
            })
        except Exception as e:
            steps.append({"step": "start_run", "error": str(e)})
            return {"steps": steps}

        if run_resp.status_code not in (200, 201):
            return {"steps": steps, "conclusion": "Run failed to start — check token and credits"}

        run_id = run_resp.json()["data"]["id"]

        # Poll up to 90s
        final_status = "UNKNOWN"
        for i in range(18):
            await asyncio.sleep(5)
            try:
                poll = await client.get(
                    f"https://api.apify.com/v2/actor-runs/{run_id}",
                    params={"token": APIFY_API_TOKEN},
                )
                final_status = poll.json()["data"]["status"]
                steps.append({"step": f"poll_{i+1}", "status": final_status})
                if final_status in ("SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"):
                    break
            except Exception as e:
                steps.append({"step": f"poll_{i+1}", "error": str(e)})

        if final_status != "SUCCEEDED":
            return {"steps": steps, "conclusion": f"Run ended with status={final_status}"}

        # Fetch dataset
        try:
            run_data = await client.get(
                f"https://api.apify.com/v2/actor-runs/{run_id}",
                params={"token": APIFY_API_TOKEN},
            )
            dataset_id = run_data.json()["data"]["defaultDatasetId"]
            items_resp = await client.get(
                f"https://api.apify.com/v2/datasets/{dataset_id}/items",
                params={"token": APIFY_API_TOKEN},
            )
            items = items_resp.json() if items_resp.status_code == 200 else []
            steps.append({
                "step": "dataset",
                "dataset_id": dataset_id,
                "item_count": len(items),
                "sample_keys": list(items[0].keys()) if items else [],
                "first_item_text_preview": items[0].get("text", "")[:200] if items else None,
            })
            return {
                "keyword": keyword,
                "item_count": len(items),
                "steps": steps,
                "conclusion": f"{'OK — got items' if items else 'Run SUCCEEDED but dataset is EMPTY'}",
            }
        except Exception as e:
            steps.append({"step": "dataset", "error": str(e)})
            return {"steps": steps}


@router.get("/debug-scrape/")
async def debug_scrape(
    keyword: str = Query(default="can anyone recommend marketing agency"),
    platform: str = Query(default="linkedin"),
):
    """Fetch raw posts from one platform/keyword — NO scoring, NO filtering.
    Use this to see exactly what the scraper returns before any LLM touches it."""
    async with httpx.AsyncClient(timeout=300) as client:
        if platform == "linkedin":
            posts = await fetch_apify_results(client, keyword)
        elif platform == "twitter":
            posts = await fetch_twitter_results(client, keyword)
        elif platform == "reddit":
            posts = await fetch_reddit_results(client, keyword)
        else:
            return {"error": f"Unknown platform: {platform}"}

    # Return cleaned summary + full text so we can read what's coming through
    return {
        "keyword": keyword,
        "platform": platform,
        "count": len(posts),
        "posts": [
            {
                "author": f"{p.get('author',{}).get('firstName','')} {p.get('author',{}).get('lastName','')}".strip(),
                "occupation": p.get("author", {}).get("occupation", ""),
                "platform": p.get("_platform", platform),
                "url": p.get("url", ""),
                "posted_at": p.get("postedAt", ""),
                "text_length": len(p.get("text", "")),
                "text": p.get("text", ""),   # full text — no truncation
            }
            for p in posts
        ]
    }


async def _run_and_unlock(keywords, domain, user_id, service=None):
    global _scan_in_progress
    try:
        stats = await run_ingestion(keywords, domain, user_id, service_override=service)
        # Scope stats to the user who triggered the scan
        _last_scan_stats[user_id or ""] = stats
    finally:
        _scan_in_progress = False

@router.post("/")
async def trigger_ingestion(
    background_tasks: BackgroundTasks,
    req: IngestRequest = Body(default=IngestRequest())
):
    global _scan_in_progress
    if _scan_in_progress:
        return {"status": "scan_in_progress", "message": "A scan is already running"}

    _scan_in_progress = True

    # TODO: re-enable 30-min cooldown before production deploy
    if req.user_id:
        supabase.table("users").update({
            "last_scanned_at": datetime.now(timezone.utc).isoformat()
        }).eq("id", req.user_id).execute()

    background_tasks.add_task(_run_and_unlock, req.keywords, req.domain, req.user_id, req.service)
    return {"status": "Scan started in background"}
