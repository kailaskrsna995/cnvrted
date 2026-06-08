import httpx
from fastapi import APIRouter, Query
from app.config import NEWS_API_KEY
from app.database import supabase

router = APIRouter(prefix="/news", tags=["news"])

NEWSAPI_URL = "https://newsapi.org/v2/everything"


def _build_query(service: str) -> str:
    """
    Turn a service description into a clean NewsAPI search query.
    Strips filler words, keeps the core topic nouns.
    e.g. "we are an influencer marketing agency for AI brands"
      → "influencer marketing"
    """
    STRIP = {
        "we", "are", "an", "a", "the", "is", "for", "and", "or",
        "our", "i", "my", "do", "does", "that", "with", "of",
        "agency", "company", "studio", "firm", "team", "service",
        "services", "looking", "brands", "clients", "helping",
        "help", "provide", "providing", "offer", "offering",
    }
    words = service.lower().split()
    keywords = [w for w in words if w not in STRIP and len(w) > 2]
    # Take first 3 meaningful words — NewsAPI works best with short focused queries
    return " ".join(keywords[:3]) if keywords else service[:50]


@router.get("/")
async def get_news(user_id: str = Query(...), limit: int = 20):
    """
    Fetch latest news relevant to the user's service.
    Uses their service_offering from the users table as the search query.
    Returns up to `limit` articles sorted by publishedAt desc.
    """
    if not NEWS_API_KEY:
        return {"articles": [], "query": "", "error": "NEWS_API_KEY not configured"}

    # Load user's service description
    service = ""
    try:
        result = supabase.table("users") \
            .select("service_offering, onboarding_data") \
            .eq("id", user_id) \
            .execute()
        if result.data:
            u = result.data[0]
            od = u.get("onboarding_data") or {}
            service = u.get("service_offering") or od.get("company_do", "")
    except Exception as e:
        print(f"[News] Could not fetch user service: {e}")

    query = "startup funding product launch"
    print(f"[News] user_id={user_id} query='{query}'")

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                NEWSAPI_URL,
                params={
                    "q":        query,
                    "language": "en",
                    "sortBy":   "publishedAt",
                    "pageSize": min(limit, 20),  # NewsAPI max per page = 100, we cap at 20
                    "apiKey":   NEWS_API_KEY,
                },
            )

        if resp.status_code != 200:
            print(f"[News] API error {resp.status_code}: {resp.text[:200]}")
            return {"articles": [], "query": query, "error": f"NewsAPI error {resp.status_code}"}

        data = resp.json()
        raw_articles = data.get("articles", [])

        # Clean up — remove articles with no title or [Removed] content
        articles = []
        for a in raw_articles:
            title = a.get("title", "") or ""
            if not title or title == "[Removed]":
                continue
            articles.append({
                "title":        title,
                "description":  a.get("description") or "",
                "url":          a.get("url") or "",
                "source":       (a.get("source") or {}).get("name") or "",
                "published_at": a.get("publishedAt") or "",
                "image_url":    a.get("urlToImage") or "",
            })

        print(f"[News] query='{query}' → {len(articles)} articles")
        return {
            "articles": articles,
            "query":    query,
            "total":    len(articles),
        }

    except Exception as e:
        print(f"[News] Error: {e}")
        return {"articles": [], "query": query, "error": str(e)}
