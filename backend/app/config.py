from dotenv import load_dotenv
import os

load_dotenv(override=True)

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
APIFY_API_TOKEN = os.getenv("APIFY_API_TOKEN")
APOLLO_API_KEY = os.getenv("APOLLO_API_KEY", "")
