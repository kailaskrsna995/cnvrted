import httpx
from fastapi import APIRouter, HTTPException
from app.config import APOLLO_API_KEY, HUNTER_API_KEY
from app.database import supabase

router = APIRouter(prefix="/leads", tags=["enrich"])

APOLLO_URL  = "https://api.apollo.io/api/v1/people/match"
HUNTER_BASE = "https://api.hunter.io/v2"


def _parse_name(full_name: str):
    parts = full_name.strip().split(" ", 1)
    first = parts[0] if parts else ""
    last  = parts[1] if len(parts) > 1 else ""
    return first, last


async def _hunter_enrich(client: httpx.AsyncClient, first: str, last: str, company: str, linkedin_url: str) -> dict:
    """Try Hunter.io — returns {email, phone} or empty strings."""
    if not HUNTER_API_KEY:
        return {"email": "", "phone": ""}

    domain = ""

    # Step 1 — get domain from LinkedIn URL company or company name
    if company:
        try:
            r = await client.get(
                f"{HUNTER_BASE}/domain-search",
                params={"company": company, "api_key": HUNTER_API_KEY, "limit": 1},
                timeout=10,
            )
            if r.status_code == 200:
                domain = r.json().get("data", {}).get("domain", "")
        except Exception as e:
            print(f"[Hunter] domain-search error: {e}")

    if not domain:
        return {"email": "", "phone": ""}

    # Step 2 — find email with domain + name
    try:
        r = await client.get(
            f"{HUNTER_BASE}/email-finder",
            params={
                "domain":     domain,
                "first_name": first,
                "last_name":  last,
                "api_key":    HUNTER_API_KEY,
            },
            timeout=10,
        )
        if r.status_code == 200:
            data  = r.json().get("data", {})
            email = data.get("email", "")
            print(f"[Hunter] {first} {last} @ {domain} → {email}")
            return {"email": email, "phone": ""}
    except Exception as e:
        print(f"[Hunter] email-finder error: {e}")

    return {"email": "", "phone": ""}


async def _apollo_enrich(client: httpx.AsyncClient, first: str, last: str, company: str, linkedin_url: str) -> dict:
    """Try Apollo — returns {email, phone} or empty strings."""
    if not APOLLO_API_KEY:
        return {"email": "", "phone": ""}

    payload: dict = {"first_name": first, "last_name": last, "reveal_personal_emails": True}
    if company:
        payload["organization_name"] = company
    if linkedin_url and "linkedin.com" in linkedin_url:
        payload["linkedin_url"] = linkedin_url

    try:
        resp = await client.post(
            APOLLO_URL,
            headers={"x-api-key": APOLLO_API_KEY, "Content-Type": "application/json", "Cache-Control": "no-cache"},
            json=payload,
            timeout=30,
        )
        if resp.status_code != 200:
            print(f"[Apollo] Error {resp.status_code}: {resp.text[:200]}")
            return {"email": "", "phone": ""}

        person = resp.json().get("person", {})
        email  = (person.get("personal_emails") or [person.get("email", "")])[0] or ""
        phones = person.get("phone_numbers", [])
        phone  = phones[0].get("raw_number", "") if phones else ""
        print(f"[Apollo] {first} {last} → email={email} phone={phone}")
        return {"email": email, "phone": phone}
    except Exception as e:
        print(f"[Apollo] error: {e}")
        return {"email": "", "phone": ""}


@router.post("/{lead_id}/enrich/")
async def enrich_lead(lead_id: str):
    # Fetch lead from DB
    result = supabase.table("leads").select("*").eq("lead_id", lead_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Lead not found")

    lead = result.data[0]

    # Return cached data if already enriched
    if lead.get("contact_email") or lead.get("contact_phone"):
        return {
            "contact_email": lead.get("contact_email", ""),
            "contact_phone": lead.get("contact_phone", ""),
            "found": bool(lead.get("contact_email") or lead.get("contact_phone")),
            "cached": True,
        }

    first, last   = _parse_name(lead.get("author", ""))
    company       = lead.get("company", "") or ""
    linkedin_url  = lead.get("contact_linkedin", "") or ""
    platform      = lead.get("platform", "linkedin")

    # For Twitter leads extract company hint from profession/bio
    if platform == "twitter" and not company:
        profession = lead.get("profession", "") or ""
        # Simple heuristic: "Founder at Acme" → "Acme"
        for marker in [" at ", " @ ", " | ", " - "]:
            if marker in profession:
                company = profession.split(marker)[-1].strip().split(" ")[0]
                break

    async with httpx.AsyncClient() as client:
        # Primary: Hunter.io (free tier)
        result_data = await _hunter_enrich(client, first, last, company, linkedin_url)

        # Fallback: Apollo
        if not result_data["email"]:
            result_data = await _apollo_enrich(client, first, last, company, linkedin_url)

    email = result_data["email"]
    phone = result_data["phone"]
    found = bool(email or phone)

    # Save back to DB only if we found something
    if found:
        supabase.table("leads").update({
            "contact_email": email,
            "contact_phone": phone,
        }).eq("lead_id", lead_id).execute()

    return {
        "contact_email": email,
        "contact_phone": phone,
        "found": found,
        "cached": False,
    }
