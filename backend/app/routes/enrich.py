import re
import httpx
from fastapi import APIRouter, HTTPException
from app.config import HUNTER_API_KEY
from app.database import supabase

router = APIRouter(prefix="/leads", tags=["enrich"])

HUNTER_BASE = "https://api.hunter.io/v2"

# Regex patterns for extracting contact info directly from post text
EMAIL_RE = re.compile(r"[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}")
PHONE_RE = re.compile(r"(?:\+?\d[\d\s\-().]{7,}\d)")


def _extract_from_text(text: str) -> dict:
    """Extract email and phone directly from post text — free, instant."""
    email = ""
    phone = ""
    if text:
        email_match = EMAIL_RE.search(text)
        if email_match:
            email = email_match.group(0)
        phone_match = PHONE_RE.search(text)
        if phone_match:
            raw = phone_match.group(0).strip()
            # Only keep if it looks like a real phone (at least 7 digits)
            digits = re.sub(r"\D", "", raw)
            if len(digits) >= 7:
                phone = raw
    return {"email": email, "phone": phone}


def _parse_name(full_name: str):
    parts = full_name.strip().split(" ", 1)
    first = parts[0] if parts else ""
    last  = parts[1] if len(parts) > 1 else ""
    return first, last


async def _hunter_enrich(client: httpx.AsyncClient, first: str, last: str, company: str) -> dict:
    """
    Hunter.io two-step lookup:
      1. domain-search by company name → get domain
      2. email-finder by domain + name → get email
    Returns {email, phone} or empty strings.
    Hard timeout: 8s per call, 16s max total.
    """
    if not HUNTER_API_KEY:
        return {"email": "", "phone": ""}

    domain = ""

    # Step 1 — find domain from company name
    if company:
        try:
            r = await client.get(
                f"{HUNTER_BASE}/domain-search",
                params={"company": company, "api_key": HUNTER_API_KEY, "limit": 1},
                timeout=8,
            )
            if r.status_code == 200:
                domain = r.json().get("data", {}).get("domain", "")
        except Exception as e:
            print(f"[Hunter] domain-search error: {e}")

    if not domain:
        print(f"[Hunter] No domain found for company='{company}'")
        return {"email": "", "phone": ""}

    # Step 2 — find email from domain + name
    try:
        r = await client.get(
            f"{HUNTER_BASE}/email-finder",
            params={
                "domain":     domain,
                "first_name": first,
                "last_name":  last,
                "api_key":    HUNTER_API_KEY,
            },
            timeout=8,
        )
        if r.status_code == 200:
            data  = r.json().get("data", {})
            email = data.get("email", "")
            print(f"[Hunter] {first} {last} @ {domain} → email={email}")
            return {"email": email, "phone": ""}
    except Exception as e:
        print(f"[Hunter] email-finder error: {e}")

    return {"email": "", "phone": ""}


@router.post("/{lead_id}/enrich/")
async def enrich_lead(lead_id: str):
    # Fetch lead from DB
    result = supabase.table("leads").select("*").eq("lead_id", lead_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = result.data[0]

    # ── Step 1: return cached DB data if already enriched ──────────────────
    if lead.get("contact_email") or lead.get("contact_phone"):
        return {
            "contact_email": lead.get("contact_email", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "source":        "cached",
            "found":         True,
        }

    # ── Step 2: extract directly from post text (free, instant) ────────────
    post_text = lead.get("post_text", "") or ""
    extracted = _extract_from_text(post_text)
    if extracted["email"] or extracted["phone"]:
        supabase.table("leads").update({
            "contact_email": extracted["email"],
            "contact_phone": extracted["phone"],
        }).eq("lead_id", lead_id).execute()
        return {
            "contact_email": extracted["email"],
            "contact_phone": extracted["phone"],
            "source":        "post",
            "found":         True,
        }

    # ── Step 3: try Hunter.io ───────────────────────────────────────────────
    first, last  = _parse_name(lead.get("author", ""))
    company      = lead.get("company", "") or ""
    platform     = lead.get("platform", "linkedin")

    # For Twitter leads: extract company hint from profession/bio
    if platform == "twitter" and not company:
        profession = lead.get("profession", "") or ""
        for marker in [" at ", " @ ", " | ", " - "]:
            if marker in profession:
                company = profession.split(marker)[-1].strip().split(" ")[0]
                break

    if company and first:
        async with httpx.AsyncClient() as client:
            hunter_result = await _hunter_enrich(client, first, last, company)

        email = hunter_result["email"]
        phone = hunter_result["phone"]

        if email or phone:
            supabase.table("leads").update({
                "contact_email": email,
                "contact_phone": phone,
            }).eq("lead_id", lead_id).execute()
            return {
                "contact_email": email,
                "contact_phone": phone,
                "source":        "hunter",
                "found":         True,
            }

    # ── Step 4: nothing found ───────────────────────────────────────────────
    # Mark as attempted so we don't keep trying
    supabase.table("leads").update({
        "contact_email": "",
        "contact_phone": "",
    }).eq("lead_id", lead_id).execute()

    return {
        "contact_email": "",
        "contact_phone": "",
        "source":        "none",
        "found":         False,
        "message":       "Not available",
    }
