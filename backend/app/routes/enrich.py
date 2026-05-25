import httpx
from fastapi import APIRouter, HTTPException
from app.config import APOLLO_API_KEY
from app.database import supabase

router = APIRouter(prefix="/leads", tags=["enrich"])

APOLLO_URL = "https://api.apollo.io/api/v1/people/match"


def _parse_name(full_name: str):
    parts = full_name.strip().split(" ", 1)
    first = parts[0] if parts else ""
    last = parts[1] if len(parts) > 1 else ""
    return first, last


@router.post("/{lead_id}/enrich/")
async def enrich_lead(lead_id: str):
    if not APOLLO_API_KEY:
        raise HTTPException(status_code=503, detail="Apollo API key not configured")

    # Fetch lead from DB
    result = supabase.table("leads").select("*").eq("lead_id", lead_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = result.data[0]

    # Only enrich LinkedIn leads
    if lead.get("platform", "linkedin") != "linkedin":
        return {
            "contact_email": lead.get("contact_email", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "cached": True
        }

    # Return cached data if already enriched
    if lead.get("contact_email") or lead.get("contact_phone"):
        return {
            "contact_email": lead.get("contact_email", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "cached": True
        }

    first_name, last_name = _parse_name(lead.get("author", ""))
    company = lead.get("company", "")
    linkedin_url = lead.get("contact_linkedin", "")

    payload = {
        "first_name": first_name,
        "last_name": last_name,
        "reveal_personal_emails": True,
        # reveal_phone_number requires a webhook_url — not supported in sync mode
    }
    if company:
        payload["organization_name"] = company
    if linkedin_url and "linkedin.com" in linkedin_url:
        payload["linkedin_url"] = linkedin_url

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            APOLLO_URL,
            headers={
                "x-api-key": APOLLO_API_KEY,
                "Content-Type": "application/json",
                "Cache-Control": "no-cache",
            },
            json=payload
        )

    if resp.status_code != 200:
        print(f"[Apollo] Error {resp.status_code}: {resp.text[:200]}")
        raise HTTPException(status_code=502, detail="Apollo enrichment failed")

    data = resp.json()
    person = data.get("person", {})

    email = ""
    # Try personal emails first, fall back to work email
    personal_emails = person.get("personal_emails", [])
    if personal_emails:
        email = personal_emails[0]
    elif person.get("email"):
        email = person["email"]

    phone = ""
    phone_numbers = person.get("phone_numbers", [])
    if phone_numbers:
        phone = phone_numbers[0].get("raw_number", "")

    print(f"[Apollo] {lead.get('author')} → email={email} phone={phone}")

    # Save back to DB
    supabase.table("leads").update({
        "contact_email": email,
        "contact_phone": phone,
    }).eq("lead_id", lead_id).execute()

    return {
        "contact_email": email,
        "contact_phone": phone,
        "cached": False
    }
