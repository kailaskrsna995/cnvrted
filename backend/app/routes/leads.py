from fastapi import APIRouter, Query
from app.database import supabase

router = APIRouter(prefix="/leads", tags=["leads"])

@router.get("/")
def get_leads(category: str = Query(None), limit: int = 50):
    query = supabase.table("leads").select("*").eq("qualified", True).order("ingested_at", desc=True).limit(limit)
    if category:
        query = query.eq("category", category)
    result = query.execute()
    return result.data

@router.get("/stats")
def get_stats():
    result = supabase.table("leads").select("category").eq("qualified", True).execute()
    counts = {}
    for row in result.data:
        cat = row["category"]
        counts[cat] = counts.get(cat, 0) + 1
    return counts
