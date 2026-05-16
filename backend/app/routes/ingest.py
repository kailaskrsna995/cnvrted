from fastapi import APIRouter, BackgroundTasks
from app.ingestion import run_ingestion
from app.database import supabase
from app.scorer import score_post
import hashlib, uuid
from datetime import datetime, timedelta
import random

router = APIRouter(prefix="/ingest", tags=["ingest"])

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
            "urgency": scored.get("urgency", "High"),
            "qualified": True,
            "source_url": f"https://linkedin.com/mock/{lead_id}",
            "posted_at": (datetime.utcnow() - timedelta(minutes=mins_ago)).isoformat(),
        }
        supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
        inserted.append(lead)
    return {"seeded": len(inserted)}

@router.post("/")
async def trigger_ingestion(background_tasks: BackgroundTasks):
    background_tasks.add_task(run_ingestion)
    return {"status": "Scan started in background"}
