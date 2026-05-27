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
_last_scan_stats = {"total_scanned": 0, "total_rejected": 0, "total_saved": 0}


class IngestRequest(BaseModel):
    user_id: Optional[str] = None
    keywords: Optional[List[str]] = None
    domain: Optional[str] = None

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
def scan_status():
    return {"scanning": _scan_in_progress, **_last_scan_stats}

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


async def _run_and_unlock(keywords, domain, user_id):
    global _scan_in_progress, _last_scan_stats
    try:
        stats = await run_ingestion(keywords, domain, user_id)
        _last_scan_stats = stats
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

    background_tasks.add_task(_run_and_unlock, req.keywords, req.domain, req.user_id)
    return {"status": "Scan started in background"}
