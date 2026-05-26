from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.database import supabase
from app.scorer import map_query_to_search

router = APIRouter(prefix="/chat", tags=["chat"])


class ChatRequest(BaseModel):
    user_id: Optional[str] = None
    message: str


@router.post("/")
def chat(req: ChatRequest):
    # Fetch user context from onboarding
    context_parts = []
    if req.user_id:
        result = supabase.table("users").select("service_offering, icp, onboarding_data").eq("id", req.user_id).execute()
        if result.data:
            u = result.data[0]
            od = u.get("onboarding_data") or {}
            svc = u.get("service_offering") or od.get("company_do", "")
            icp = u.get("icp") or od.get("icp", "")
            if svc:
                context_parts.append(f"sells: {svc}")
            if icp:
                context_parts.append(f"targets: {icp}")

    enriched = req.message
    if context_parts:
        enriched = f"{req.message}. Context: {', '.join(context_parts)}"

    result = map_query_to_search(enriched)
    return {
        "domain": result.get("domain", ""),
        "keywords": result.get("keywords", []),
    }
