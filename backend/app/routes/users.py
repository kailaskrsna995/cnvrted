from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.database import supabase
from app.scorer import map_query_to_search

users_router = APIRouter(prefix="/users", tags=["users"])
search_router = APIRouter(tags=["search"])


class CreateUserRequest(BaseModel):
    name: str
    position: str = ""


class SearchRequest(BaseModel):
    raw_query: str


@users_router.post("/")
def create_user(req: CreateUserRequest):
    result = supabase.table("users").insert({
        "name": req.name,
        "position": req.position
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


@search_router.post("/search/")
def search(req: SearchRequest):
    return map_query_to_search(req.raw_query)
