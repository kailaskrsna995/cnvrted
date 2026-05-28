from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List
from app.database import supabase
from app.scorer import map_query_to_search
import hashlib

users_router = APIRouter(prefix="/users", tags=["users"])
search_router = APIRouter(tags=["search"])


class AuthRequest(BaseModel):
    username: str
    password: str
    name: str = ""
    profession: str = ""
    company_name: str = ""
    company_url: str = ""
    company_email: str = ""


class PreferencesRequest(BaseModel):
    service_offering: str = ""
    target_industries: List[str] = []
    company_size: str = ""
    # Full onboarding data
    company_name: str = ""
    contact_email: str = ""
    contact_phone: str = ""
    icp: str = ""
    icp_changed: bool | None = None
    icp_changed_how: str = ""
    gtm_motions: List[str] = []
    gtm_other: str = ""
    acquisition_channels: List[str] = []
    acquisition_other: str = ""
    sales_cycle: str = ""
    competitors: str = ""
    same_contact: bool = True
    contact_name: str = ""
    contact_role: str = ""
    leads_contact_email: str = ""
    deal_size: str = ""
    best_customers: str = ""
    include_news: bool = True


class SearchRequest(BaseModel):
    raw_query: str


def hash_password(password: str) -> str:
    return hashlib.sha256(password.encode()).hexdigest()


@users_router.post("/auth/")
def auth(req: AuthRequest):
    existing = supabase.table("users").select("*").eq("username", req.username).execute()

    if existing.data:
        user = existing.data[0]
        if user["password_hash"] != hash_password(req.password):
            raise HTTPException(status_code=401, detail="Incorrect password")
        return user

    # New user — register
    try:
        result = supabase.table("users").insert({
            "username": req.username,
            "name": req.name,
            "profession": req.profession,
            "password_hash": hash_password(req.password),
            "onboarding_data": {
                "company_name": req.company_name,
                "company_url": req.company_url,
                "company_email": req.company_email,
            },
        }).execute()
    except Exception as e:
        # Unique constraint violation — username already taken
        if "unique" in str(e).lower() or "duplicate" in str(e).lower():
            raise HTTPException(status_code=409, detail="Username already taken.")
        raise HTTPException(status_code=500, detail="Registration failed.")

    return result.data[0]


@users_router.get("/{user_id}/")
def get_user(user_id: str):
    result = supabase.table("users").select("*").eq("id", user_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return result.data[0]


@users_router.post("/{user_id}/saves/{lead_id}/")
def save_post(user_id: str, lead_id: str):
    supabase.table("saved_posts").upsert(
        {"user_id": user_id, "lead_id": lead_id},
        on_conflict="user_id,lead_id"
    ).execute()
    return {"saved": True}


@users_router.delete("/{user_id}/saves/{lead_id}/")
def unsave_post(user_id: str, lead_id: str):
    supabase.table("saved_posts").delete().eq("user_id", user_id).eq("lead_id", lead_id).execute()
    return {"saved": False}


@users_router.get("/{user_id}/saves/")
def get_saved_lead_ids(user_id: str):
    result = supabase.table("saved_posts").select("lead_id").eq("user_id", user_id).execute()
    return [r["lead_id"] for r in result.data]


@users_router.patch("/{user_id}/preferences/")
def update_preferences(user_id: str, req: PreferencesRequest):
    onboarding_data = {
        "company_name": req.company_name,
        "contact_email": req.contact_email,
        "contact_phone": req.contact_phone,
        "icp": req.icp,
        "icp_changed": req.icp_changed,
        "icp_changed_how": req.icp_changed_how,
        "gtm_motions": req.gtm_motions,
        "gtm_other": req.gtm_other,
        "acquisition_channels": req.acquisition_channels,
        "acquisition_other": req.acquisition_other,
        "sales_cycle": req.sales_cycle,
        "competitors": req.competitors,
        "same_contact": req.same_contact,
        "contact_name": req.contact_name,
        "contact_role": req.contact_role,
        "leads_contact_email": req.leads_contact_email,
        "deal_size": req.deal_size,
        "best_customers": req.best_customers,
        "include_news": req.include_news,
    }
    supabase.table("users").update({
        "service_offering": req.service_offering,
        "target_industries": req.target_industries,
        "company_size": req.company_size,
        "onboarding_data": onboarding_data,
    }).eq("id", user_id).execute()
    return {"updated": True}


@search_router.post("/search/")
def search(req: SearchRequest):
    return map_query_to_search(req.raw_query)
