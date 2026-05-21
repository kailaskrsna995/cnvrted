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


class PreferencesRequest(BaseModel):
    service_offering: str = ""
    target_industries: List[str] = []
    company_size: str = ""


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
    if not req.username.endswith("@cnvrted.com"):
        raise HTTPException(status_code=403, detail="Access denied. Only @cnvrted.com emails are allowed.")

    result = supabase.table("users").insert({
        "username": req.username,
        "name": req.name,
        "profession": req.profession,
        "password_hash": hash_password(req.password),
        "status": "approved"
    }).execute()
    
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
    supabase.table("users").update({
        "service_offering": req.service_offering,
        "target_industries": req.target_industries,
        "company_size": req.company_size,
    }).eq("id", user_id).execute()
    return {"updated": True}


@search_router.post("/search/")
def search(req: SearchRequest):
    return map_query_to_search(req.raw_query)
