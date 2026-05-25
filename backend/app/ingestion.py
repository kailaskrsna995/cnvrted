import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post
from typing import Optional, List

KEYWORDS = {
    "AI Automation": [
        "recommend chatbot developer",
        "automate our workflow help",
        "looking for developer automate",
        "anyone built automation for",
    ],
    "Marketing": [
        "recommend paid ads agency",
        "our ads not performing",
        "looking for Facebook ads help",
        "need marketing agency recommend",
    ]
}

APIFY_ACTOR = "supreme_coder~linkedin-post"
REDDIT_ACTOR = "automation-lab~reddit-scraper"
TWITTER_ACTOR = "apidojo~tweet-scraper"

# LinkedIn geo URN lookup — covers countries + major cities
GEO_URNS: dict[str, str] = {
    # Countries
    "india": "102713980",
    "usa": "103644278", "united states": "103644278",
    "uk": "101165590", "united kingdom": "101165590",
    "uae": "104305776", "dubai": "104305776",
    "singapore": "102454443",
    "australia": "101452733",
    "canada": "101174742",
    "germany": "101282230",
    "france": "105015875",
    "netherlands": "102890719",
    # Indian cities
    "bangalore": "105214831", "bengaluru": "105214831",
    "mumbai": "102717679", "bombay": "102717679",
    "delhi": "102713336", "new delhi": "102713336",
    "hyderabad": "105556714",
    "chennai": "105044164",
    "pune": "106164952",
    "kolkata": "105634330",
    # Global cities
    "london": "102257491",
    "new york": "105080838",
    "san francisco": "102277331",
    "toronto": "101282703",
    "sydney": "105790874",
}

def generate_lead_id(url: str, text: str, author: str) -> str:
    raw = f"{url}{text[:100]}{author}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

def build_search_url(keyword: str, location: Optional[str] = None) -> str:
    from urllib.parse import quote
    geo_param = ""
    if location:
        urn = GEO_URNS.get(location.lower().strip())
        if urn:
            geo_param = f"&geoUrn=%5B%22{urn}%22%5D"
    # TODO: change past-week back to past-24h for production
    return f"https://www.linkedin.com/search/results/content/?datePosted=%22past-week%22&keywords={quote(keyword)}&origin=FACETED_SEARCH{geo_param}"

async def fetch_apify_results(client: httpx.AsyncClient, keyword: str, location: Optional[str] = None) -> list:
    # Step 1: start run
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs",
        params={"token": APIFY_API_TOKEN},
        json={"urls": [build_search_url(keyword, location)], "limitPerSource": 15, "deepScrape": True, "rawData": False}
    )
    if run_resp.status_code not in (200, 201):
        print(f"[Apify] Failed to start run for '{keyword}': {run_resp.text[:200]}")
        return []

    run_id = run_resp.json()["data"]["id"]
    print(f"[Apify] Run started for '{keyword}' run_id={run_id}")

    # Step 2: poll until finished
    for _ in range(24):
        await asyncio.sleep(5)
        status_resp = await client.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_API_TOKEN}
        )
        status = status_resp.json()["data"]["status"]
        print(f"[Apify] '{keyword}' status={status}")
        if status in ("SUCCEEDED", "FAILED", "ABORTED"):
            break

    if status != "SUCCEEDED":
        print(f"[Apify] Run did not succeed for '{keyword}'")
        return []

    # Step 3: fetch dataset from completed run (not initial response)
    run_data_resp = await client.get(
        f"https://api.apify.com/v2/actor-runs/{run_id}",
        params={"token": APIFY_API_TOKEN}
    )
    dataset_id = run_data_resp.json()["data"]["defaultDatasetId"]
    items_resp = await client.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items",
        params={"token": APIFY_API_TOKEN}
    )
    print(f"[Apify] dataset={dataset_id} items_status={items_resp.status_code} count={len(items_resp.json()) if items_resp.status_code == 200 else 'err'}")
    return items_resp.json() if items_resp.status_code == 200 else []

# Posts containing these phrases are almost never buyers — skip before LLM
JOB_SEEKER_SIGNALS = [
    "open to work", "open to opportunities", "looking for a job",
    "seeking a role", "hire me", "my resume", "i am available",
    "i'm available", "job search", "actively looking",
]

# Sellers promoting their own services — not buyers
SELLER_SIGNALS = [
    "my agency", "our agency", "i built this", "i created this",
    "we specialize in", "i offer", "dm me", "reach out to me",
    "check out my", "here's how i", "i helped a client",
    "book a call", "schedule a call", "free consultation", "link in bio",
    "i specialize in", "our team offers",
]

# Posts must contain at least one of these to be worth scoring
BUYING_SIGNALS = [
    "looking for", "need a", "need an", "we need", "searching for",
    "can anyone recommend", "anyone recommend", "anyone know a good",
    "help with", "seeking a vendor", "seeking a partner",
    "looking to hire", "want to hire", "looking to outsource", "need to hire",
    "budget", "agency", "contractor", "outsource", "freelancer", "freelance",
    "service provider", "need help finding", "who do you use",
    # Creative / project-based buying signals
    "recommend someone", "recommend a", "know anyone", "know someone who",
    "hire someone", "find someone", "need someone", "find a good",
    "looking to work with", "open to collaborat", "looking to connect with",
    "shoot", "produce", "edit", "create content", "make a video",
    "production company", "video production", "creative agency",
    "need help with", "require a", "require an",
    # Company hiring signals — growing companies are buyers too
    "we're hiring", "we are hiring", "now hiring", "hiring for",
    "open role", "open position", "join our team", "looking to bring on",
]


def _is_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if ord(c) < 128) / len(letters) > 0.8


def _has_buying_signal(text: str) -> bool:
    lower = text.lower()
    if any(sig in lower for sig in JOB_SEEKER_SIGNALS):
        return False
    if any(sig in lower for sig in SELLER_SIGNALS):
        return False
    return any(sig in lower for sig in BUYING_SIGNALS)


def _process_posts(posts: list, category: str, user_id: Optional[str], location: Optional[str] = None) -> tuple:
    results = []
    total_scanned = 0
    for post in posts:
        total_scanned += 1
        try:
            text = post.get("text", "")
            if not text or len(text) < 50:
                continue
            if not _is_english(text):
                print(f"[Filter] Non-English: {text[:60]}")
                continue
            if not _has_buying_signal(text):
                print(f"[Filter] No buying signal: {text[:60]}")
                continue
            author_data = post.get("author", {})
            first = author_data.get("firstName", "")
            last = author_data.get("lastName", "")
            author = f"{first} {last}".strip()
            if not author:
                continue
            occupation = author_data.get("occupation", "")
            profile_id = author_data.get("publicId", "")
            url = post.get("url", "")

            scored = score_post(text, category_hint=category)
            if not scored.get("qualified"):
                print(f"[Filter] Discarded — score={scored.get('intent_score')} text={text[:60]}")
                continue
            # Force category to match searched domain so leads stay in the right feed
            if category and category != "Custom":
                scored["category"] = category

            # Extract posted_at — Apify actor field name varies across platforms
            raw_date = (
                post.get("postedAt") or
                post.get("posted_at") or
                post.get("date") or
                post.get("publishedAt") or
                post.get("createdAt") or
                post.get("timeSincePosted") or
                post.get("time") or
                post.get("postDate") or
                post.get("created_utc")
            )
            if raw_date is None:
                print(f"[DateDebug] No date field — platform={post.get('_platform','linkedin')} keys={list(post.keys())}")
            posted_at = None
            if raw_date:
                try:
                    from datetime import datetime as _dt, timedelta as _td
                    import re as _re
                    if isinstance(raw_date, (int, float)):
                        # Unix timestamp (ms if > 1e10, else seconds)
                        ts = raw_date / 1000 if raw_date > 1e10 else raw_date
                        posted_at = _dt.utcfromtimestamp(ts).isoformat()
                    elif isinstance(raw_date, str):
                        # Relative time strings: "2h", "3d", "1w", "2 hours ago", "3 days ago"
                        s = raw_date.strip().lower()
                        m = _re.match(r'^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week)', s)
                        if m:
                            n, unit = int(m.group(1)), m.group(2)
                            delta = {
                                's': _td(seconds=n), 'sec': _td(seconds=n),
                                'm': _td(minutes=n), 'min': _td(minutes=n),
                                'h': _td(hours=n), 'hr': _td(hours=n), 'hour': _td(hours=n),
                                'd': _td(days=n), 'day': _td(days=n),
                                'w': _td(weeks=n), 'week': _td(weeks=n),
                            }.get(unit)
                            if delta:
                                posted_at = (_dt.utcnow() - delta).isoformat()
                        else:
                            posted_at = str(raw_date)
                except Exception:
                    posted_at = None

            # Drop Twitter posts older than 4 days
            if post.get("_platform") == "twitter" and posted_at:
                try:
                    from datetime import datetime as _dt2
                    age = (_dt2.utcnow() - _dt2.fromisoformat(posted_at.replace("Z", ""))).days
                    if age > 4:
                        print(f"[Filter] Twitter post too old ({posted_at[:10]}): {text[:60]}")
                        continue
                except Exception:
                    pass

            lead_id = generate_lead_id(url, text, author)
            lead = {
                "lead_id": lead_id,
                "platform": post.get("_platform", "linkedin"),
                "author": author,
                "profession": occupation,
                "company": "",
                "post_text": text,
                "category": scored["category"],
                "intent_score": scored["intent_score"],
                "timeline": scored.get("timeline", "Active"),
                "qualified": scored["qualified"],
                "exact_need": scored.get("exact_need", ""),
                "domain": scored.get("domain", ""),
                "contact_email": scored.get("contact_email", ""),
                "contact_phone": scored.get("contact_phone", ""),
                "contact_linkedin": (
                    f"https://twitter.com/{profile_id}" if post.get("_platform") == "twitter" and profile_id else
                    f"https://reddit.com/user/{author}" if post.get("_platform") == "reddit" else
                    f"https://www.linkedin.com/in/{profile_id}" if profile_id else ""
                ),
                "source_url": url,
                "posted_at": posted_at,
                "user_id": user_id,
                "tokens_used": scored.get("tokens_used", 0),
                "location": location or "",
            }
            supabase.table("leads").upsert(lead, on_conflict="lead_id").execute()
            results.append(lead)
            print(f"[Saved] {author} | score={scored['intent_score']} | {text[:60]}")
        except Exception as e:
            print(f"[Error] processing post: {e}")
    return results, total_scanned


async def _run_apify_actor(client: httpx.AsyncClient, actor: str, payload: dict, platform: str) -> list:
    """Generic Apify actor runner — starts run, polls, fetches dataset."""
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{actor}/runs",
        params={"token": APIFY_API_TOKEN},
        json=payload
    )
    if run_resp.status_code not in (200, 201):
        print(f"[{platform}] Failed to start run: {run_resp.text[:200]}")
        return []
    run_id = run_resp.json()["data"]["id"]
    status = ""
    for _ in range(24):
        await asyncio.sleep(5)
        status_resp = await client.get(
            f"https://api.apify.com/v2/actor-runs/{run_id}",
            params={"token": APIFY_API_TOKEN}
        )
        status = status_resp.json()["data"]["status"]
        if status in ("SUCCEEDED", "FAILED", "ABORTED"):
            break
    if status != "SUCCEEDED":
        print(f"[{platform}] Run did not succeed: {status}")
        return []
    run_data = await client.get(
        f"https://api.apify.com/v2/actor-runs/{run_id}",
        params={"token": APIFY_API_TOKEN}
    )
    dataset_id = run_data.json()["data"]["defaultDatasetId"]
    items_resp = await client.get(
        f"https://api.apify.com/v2/datasets/{dataset_id}/items",
        params={"token": APIFY_API_TOKEN}
    )
    return items_resp.json() if items_resp.status_code == 200 else []


async def fetch_reddit_results(client: httpx.AsyncClient, keyword: str, location: Optional[str] = None) -> list:
    search_kw = f"{keyword} {location}" if location else keyword
    raw_items = await _run_apify_actor(client, REDDIT_ACTOR, {
        "searchQuery": search_kw,
        "sort": "new",
        "timeFilter": "week",
        "maxPostsPerSource": 25,
        "includeComments": False,
        "maxCommentsPerPost": 0,
    }, "Reddit")
    print(f"[Reddit] '{keyword}' returned {len(raw_items)} posts")
    normalised = []
    for item in raw_items:
        title = item.get("title", "")
        body = item.get("body", item.get("selftext", ""))
        text = f"{title}\n{body}".strip()
        permalink = item.get("permalink", item.get("url", ""))
        if permalink and not permalink.startswith("http"):
            permalink = f"https://reddit.com{permalink}"
        normalised.append({
            "text": text,
            "author": {
                "firstName": item.get("username", item.get("author", "Reddit User")),
                "lastName": "",
                "occupation": f"r/{item.get('subreddit', item.get('community', ''))}",
                "publicId": "",
            },
            "url": permalink,
            "postedAt": item.get("createdAt") or item.get("created_utc"),
            "_platform": "reddit",
        })
    return normalised


async def fetch_twitter_results(client: httpx.AsyncClient, keyword: str, location: Optional[str] = None) -> list:
    search_kw = f"{keyword} {location}" if location else keyword
    raw_items = await _run_apify_actor(client, TWITTER_ACTOR, {
        "searchTerms": [search_kw],
        "sort": "Latest",
        "tweetLanguage": "en",
        "maxItems": 20,
    }, "Twitter")
    print(f"[Twitter] '{keyword}' returned {len(raw_items)} posts")
    normalised = []
    for item in raw_items:
        text = item.get("text", item.get("fullText", ""))
        author_data = item.get("author", item.get("user", {}))
        username = author_data.get("name", author_data.get("userName", "Twitter User"))
        occupation = author_data.get("description", "")
        url = item.get("url", item.get("twitterUrl", ""))
        normalised.append({
            "text": text,
            "author": {
                "firstName": username,
                "lastName": "",
                "occupation": occupation,
                "publicId": author_data.get("userName", ""),
            },
            "url": url,
            "postedAt": item.get("createdAt"),
            "_platform": "twitter",
        })
    return normalised


async def run_ingestion(
    custom_keywords: Optional[List[str]] = None,
    domain: Optional[str] = None,
    user_id: Optional[str] = None,
    location: Optional[str] = None,
):
    if custom_keywords:
        keyword_map = [(domain or "Custom", kw) for kw in custom_keywords]
    else:
        keyword_map = [(cat, kw) for cat, kws in KEYWORDS.items() for kw in kws]

    print(f"[Ingestion] Keywords to scan: {[kw for _, kw in keyword_map]}")
    results = []
    total_scanned = 0
    async with httpx.AsyncClient(timeout=300) as client:
        # LinkedIn + Reddit fire in parallel
        linkedin_tasks = [fetch_apify_results(client, kw, location) for _, kw in keyword_map]
        reddit_tasks = [fetch_reddit_results(client, kw, location) for _, kw in keyword_map]
        twitter_tasks = [fetch_twitter_results(client, kw, location) for _, kw in keyword_map]
        all_results = await asyncio.gather(*linkedin_tasks, *reddit_tasks, *twitter_tasks, return_exceptions=True)

        n = len(keyword_map)
        linkedin_results = all_results[:n]
        reddit_results = all_results[n:n*2]
        twitter_results = all_results[n*2:]

        for platform_label, platform_results in [("LinkedIn", linkedin_results), ("Reddit", reddit_results), ("Twitter", twitter_results)]:
            for (category, keyword), posts in zip(keyword_map, platform_results):
                if isinstance(posts, Exception):
                    print(f"[Error] {platform_label} keyword='{keyword}': {posts}")
                    continue
                saved, scanned = _process_posts(posts, category, user_id, location)
                results.extend(saved)
                total_scanned += scanned

    total_saved = len(results)
    print(f"[Ingestion] Done — scanned={total_scanned} saved={total_saved} rejected={total_scanned - total_saved}")
    return {"total_scanned": total_scanned, "total_saved": total_saved, "total_rejected": total_scanned - total_saved}
