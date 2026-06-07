from dotenv import load_dotenv
import os

load_dotenv(override=True)

# Supabase (V2 — new project)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

# Anthropic
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")

# V1 legacy (kept so ingestion.py doesn't break during V2 build)
APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN", "")

# Agent APIs
PRAW_CLIENT_ID = os.getenv("PRAW_CLIENT_ID", "")
PRAW_CLIENT_SECRET = os.getenv("PRAW_CLIENT_SECRET", "")
PRAW_USER_AGENT = os.getenv("PRAW_USER_AGENT", "cnvrted/2.0")
CRUNCHBASE_API_KEY = os.getenv("CRUNCHBASE_API_KEY", "")
SERPER_API_KEY = os.getenv("SERPER_API_KEY", "")
EXA_API_KEY = os.getenv("EXA_API_KEY", "")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY", "")

# Enrichment APIs
HUNTER_API_KEY = os.getenv("HUNTER_API_KEY", "")
FULLENRICH_API_KEY = os.getenv("FULLENRICH_API_KEY", "")
APOLLO_API_KEY = os.getenv("APOLLO_API_KEY", "")

# Queue (Redis via Upstash — optional for Day 1, required from Day 11)
UPSTASH_REDIS_URL = os.getenv("UPSTASH_REDIS_URL", "")
UPSTASH_REDIS_TOKEN = os.getenv("UPSTASH_REDIS_TOKEN", "")

# Delivery
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
FROM_EMAIL = os.getenv("FROM_EMAIL", "leads@cnvrted.com")

# Scoring thresholds
VECTOR_SIMILARITY_THRESHOLD = float(os.getenv("VECTOR_SIMILARITY_THRESHOLD", "0.70"))
INTENT_SCORE_THRESHOLD = float(os.getenv("INTENT_SCORE_THRESHOLD", "0.60"))
MAX_LEADS_PER_DAY = int(os.getenv("MAX_LEADS_PER_DAY", "20"))
