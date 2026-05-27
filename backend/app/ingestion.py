import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post, generate_outreach
from typing import Optional, List

KEYWORDS = {
    "AI Automation": [
        "can anyone recommend AI automation",
        "need help automating",
        "who do you use for automation",
        "looking for automation consultant",
    ],
    "Marketing": [
        "can anyone recommend marketing agency",
        "who do you use for paid ads",
        "looking for a copywriter",
        "need help with our marketing",
    ]
}

# Reddit-native buying phrases — what Reddit users actually type when they want to pay someone
REDDIT_BUYER_PHRASES = [
    "anyone know a good",
    "recommend a freelancer",
    "looking to hire",
    "need someone to build",
    "hire a developer",
    "need a designer",
    "anyone used a good agency",
    "looking for recommendations",
    "will pay for",
    "budget for",
]

APIFY_ACTOR = "supreme_coder~linkedin-post"
REDDIT_ACTOR = "harshmaur~reddit-scraper"
TWITTER_ACTOR = "apidojo~tweet-scraper"

def generate_lead_id(url: str, text: str, author: str) -> str:
    raw = f"{url}{text[:100]}{author}"
    return hashlib.sha256(raw.encode()).hexdigest()[:32]

def build_search_url(keyword: str) -> str:
    from urllib.parse import quote
    # TODO: change past-week back to past-24h for production
    return f"https://www.linkedin.com/search/results/content/?datePosted=%22past-week%22&keywords={quote(keyword)}&origin=FACETED_SEARCH"

async def fetch_apify_results(client: httpx.AsyncClient, keyword: str) -> list:
    # Step 1: start run
    run_resp = await client.post(
        f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/runs",
        params={"token": APIFY_API_TOKEN},
        json={"urls": [build_search_url(keyword)], "limitPerSource": 15, "deepScrape": True, "rawData": False}
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
    """Reject obvious non-buyers. Keywords already target buyer posts so
    we trust the LLM to do the final qualification — no mandatory buying
    signal required here."""
    lower = text.lower()
    if any(sig in lower for sig in JOB_SEEKER_SIGNALS):
        return False
    if any(sig in lower for sig in SELLER_SIGNALS):
        return False
    return True


def _process_posts(posts: list, category: str, user_id: Optional[str], user_service: str = "", user_icp: str = "") -> tuple:
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
            # For Reddit: drop posts from clearly off-topic subreddits
            if post.get("_platform") == "reddit":
                occupation = (post.get("author") or {}).get("occupation", "")
                off_topic = {"gaming", "cars", "dating", "relationships", "medical",
                             "personalfinance", "investing", "politics", "news",
                             "funny", "pics", "videos", "movies", "music", "sports"}
                sub = occupation.replace("r/", "").lower()
                if sub and sub in off_topic:
                    print(f"[Filter] Reddit off-topic subreddit r/{sub}: {text[:60]}")
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

            # Extract author location by platform
            platform = post.get("_platform", "linkedin")
            if platform == "linkedin":
                author_location = (
                    author_data.get("geoRegion") or
                    author_data.get("location") or
                    author_data.get("geo") or
                    ""
                )
            elif platform == "twitter":
                author_location = post.get("_author_location", "")
            else:
                author_location = ""

            scored = score_post(text, category_hint=category)
            score = scored.get("intent_score", 0)
            if score == 0:
                print(f"[Score=0] platform={post.get('_platform','li')} | {text[:120]}")
            if not scored.get("qualified"):
                print(f"[Filter] Discarded — score={score} | {text[:80]}")
                continue
            if category and category != "Custom":
                scored["category"] = category
            outreach_line = generate_outreach(text, user_service, user_icp)

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
                        ts = raw_date / 1000 if raw_date > 1e10 else raw_date
                        posted_at = _dt.utcfromtimestamp(ts).isoformat()
                    elif isinstance(raw_date, str):
                        s = raw_date.strip()
                        # Twitter format: "Fri Mar 13 07:07:41 +0000 2026"
                        try:
                            dt = _dt.strptime(s, "%a %b %d %H:%M:%S %z %Y")
                            posted_at = dt.replace(tzinfo=None).isoformat()
                        except ValueError:
                            # Relative time: "2h", "3d", "1w"
                            m = _re.match(r'^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day|w|week)', s.lower())
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
                                # ISO / fallback — strip tz offset
                                clean = _re.sub(r'[+-]\d{2}:?\d{2}$', '', s.replace("Z", "")).strip()
                                posted_at = _dt.fromisoformat(clean).isoformat()
                except Exception:
                    posted_at = None

            # Drop Twitter posts older than 4 days
            if post.get("_platform") == "twitter":
                drop = True
                if posted_at:
                    try:
                        from datetime import datetime as _dt2
                        age_days = (_dt2.utcnow() - _dt2.fromisoformat(posted_at)).days
                        if age_days <= 4:
                            drop = False
                        else:
                            print(f"[Filter] Twitter post too old ({age_days}d): {text[:60]}")
                    except Exception as e:
                        print(f"[Filter] Twitter date parse failed ({posted_at}): {e}")
                if drop:
                    continue

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
                "location": author_location,
                "outreach_line": outreach_line,
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



# Buyer-intent subreddits — people posting these are looking to pay for things
BUYER_SUBREDDITS = (
    "entrepreneur+smallbusiness+forhire+freelance+startups"
    "+SaaS+digitalnomad+agency+businessowners+ecommerce"
    "+marketing+webdev+growthhacking+hiring"
)

async def fetch_reddit_results(client: httpx.AsyncClient, keyword: str) -> list:
    from urllib.parse import quote
    # Restrict to buyer-intent subreddits — global search returns r/gaming, r/dating, etc.
    search_url = (
        f"https://www.reddit.com/r/{BUYER_SUBREDDITS}/search/"
        f"?q={quote(keyword)}&sort=new&t=week&restrict_sr=1&type=link"
    )
    raw_items = await _run_apify_actor(client, REDDIT_ACTOR, {
        "startUrls": [{"url": search_url}],
        "searchPosts": True,
        "searchComments": False,
        "searchCommunities": False,
        "maxPostsCount": 25,
        "fastMode": True,
        "includeNSFW": False,
        "crawlCommentsPerPost": False,
        "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
    }, "Reddit")
    print(f"[Reddit] '{keyword}' returned {len(raw_items)} posts")
    if raw_items:
        print(f"[Reddit Debug] keys={list(raw_items[0].keys())}")
        print(f"[Reddit Debug] sample={raw_items[0]}")
    normalised = []
    for item in raw_items:
        # Only process posts, skip comments/communities
        if item.get("type") not in (None, "post", "link"):
            continue
        title = item.get("title", "")
        body = item.get("body", item.get("selftext", ""))
        text = f"{title}\n{body}".strip() if body else title
        if not text:
            continue
        url = item.get("postUrl") or item.get("url") or item.get("permalink") or ""
        if url and not url.startswith("http"):
            url = f"https://reddit.com{url}"
        author = (item.get("authorName") or item.get("author") or item.get("username") or "u/unknown")
        raw_sub = item.get("parsedCommunityName") or item.get("communityName") or item.get("subreddit") or ""
        subreddit = f"r/{raw_sub}" if raw_sub and not raw_sub.startswith("r/") else raw_sub
        created = item.get("createdAt") or item.get("created_utc")
        normalised.append({
            "text": text,
            "author": {
                "firstName": author,
                "lastName": "",
                "occupation": subreddit,
                "publicId": "",
            },
            "url": url,
            "postedAt": created,
            "_platform": "reddit",
        })
    return normalised


async def fetch_indiehackers_results(client: httpx.AsyncClient, keyword: str) -> list:
    """Scrape IndieHackers Ask IH section for buyer-intent posts.
    IH is Next.js — page data is embedded as __NEXT_DATA__ JSON, no Apify needed.
    """
    import re, json as _json
    from urllib.parse import quote

    # "Ask IH" is the best section — founders literally asking for tool/service recommendations
    # Also try the search page for keyword-specific results
    urls_to_try = [
        f"https://www.indiehackers.com/ask?tab=recent",
        f"https://www.indiehackers.com/search?query={quote(keyword)}",
    ]

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
    }

    all_posts = []

    for url in urls_to_try:
        try:
            resp = await client.get(url, headers=headers, follow_redirects=True, timeout=20)
            if resp.status_code != 200:
                print(f"[IH] {url} → status {resp.status_code}")
                continue

            html = resp.text

            # Extract __NEXT_DATA__ JSON embedded by Next.js
            match = re.search(r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>', html, re.DOTALL)
            if not match:
                print(f"[IH] No __NEXT_DATA__ found at {url}")
                # Fallback: try to extract post data from Open Graph / JSON-LD
                continue

            page_data = _json.loads(match.group(1))
            # Navigate to posts — structure varies by page
            posts_raw = (
                page_data.get("props", {}).get("pageProps", {}).get("posts") or
                page_data.get("props", {}).get("pageProps", {}).get("results") or
                page_data.get("props", {}).get("pageProps", {}).get("data", {}).get("posts") or
                []
            )
            print(f"[IH] {url} → {len(posts_raw)} raw posts")

            for p in posts_raw:
                title   = p.get("title", "") or p.get("headline", "")
                body    = p.get("body", "") or p.get("content", "") or p.get("description", "")
                text    = f"{title}\n{body}".strip() if body else title
                if not text:
                    continue

                slug    = p.get("slug", "") or p.get("id", "")
                post_url = f"https://www.indiehackers.com/post/{slug}" if slug else ""
                author  = (
                    p.get("userId") or
                    (p.get("user") or {}).get("username") or
                    (p.get("author") or {}).get("username") or
                    "ih-user"
                )
                created = p.get("createdAt") or p.get("publishedAt") or p.get("updatedAt")

                all_posts.append({
                    "text": text,
                    "author": {
                        "firstName": author,
                        "lastName": "",
                        "occupation": "IndieHackers",
                        "publicId": author,
                    },
                    "url": post_url,
                    "postedAt": created,
                    "_platform": "indiehackers",
                })

        except Exception as e:
            print(f"[IH] Error fetching {url}: {e}")

    print(f"[IH] '{keyword}' → {len(all_posts)} total posts")
    return all_posts


async def fetch_twitter_results(client: httpx.AsyncClient, keyword: str) -> list:
    from datetime import datetime as _dt, timedelta as _td
    since_date = (_dt.utcnow() - _td(days=4)).strftime("%Y-%m-%d")
    raw_items = await _run_apify_actor(client, TWITTER_ACTOR, {
        "searchTerms": [keyword],
        "sort": "Latest",
        "tweetLanguage": "en",
        "maxItems": 25,
        "since": since_date,
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
            "_author_location": author_data.get("location", ""),
        })
    return normalised


async def run_ingestion(
    custom_keywords: Optional[List[str]] = None,
    domain: Optional[str] = None,
    user_id: Optional[str] = None,
):
    # Fetch user context for outreach personalisation
    user_service = ""
    user_icp = ""
    if user_id:
        try:
            result = supabase.table("users").select("service_offering, onboarding_data").eq("id", user_id).execute()
            if result.data:
                u = result.data[0]
                od = u.get("onboarding_data") or {}
                user_service = u.get("service_offering") or od.get("company_do", "")
                user_icp = od.get("icp", "")
        except Exception as e:
            print(f"[Ingestion] Could not fetch user context: {e}")

    if custom_keywords:
        keyword_map = [(domain or "Custom", kw) for kw in custom_keywords]
    else:
        keyword_map = [(cat, kw) for cat, kws in KEYWORDS.items() for kw in kws]

    # Build Reddit-specific queries: use shorter, native Reddit phrasing
    # e.g. "looking to hire AI developer" stays as-is, but we also add
    # the raw domain keyword so Reddit's search doesn't over-filter
    reddit_keyword_map = []
    for cat, kw in keyword_map:
        reddit_keyword_map.append((cat, kw))
        # Also add a stripped-down version (first 3 words) for broader Reddit matches
        short_kw = " ".join(kw.split()[:3])
        if short_kw != kw:
            reddit_keyword_map.append((cat, short_kw))

    print(f"[Ingestion] LinkedIn/Twitter keywords: {[kw for _, kw in keyword_map]}")
    print(f"[Ingestion] Reddit keywords: {[kw for _, kw in reddit_keyword_map]}")
    print(f"[Ingestion] User context — service='{user_service}' icp='{user_icp}'")
    results = []
    total_scanned = 0
    async with httpx.AsyncClient(timeout=300) as client:
        linkedin_tasks = [fetch_apify_results(client, kw) for _, kw in keyword_map]
        twitter_tasks  = [fetch_twitter_results(client, kw) for _, kw in keyword_map]
        reddit_tasks   = [fetch_reddit_results(client, kw) for _, kw in reddit_keyword_map]
        # IH disabled — actor was broken, re-enable once a reliable scraper is found
        all_results = await asyncio.gather(
            *linkedin_tasks, *twitter_tasks, *reddit_tasks,
            return_exceptions=True
        )

        n  = len(keyword_map)
        nr = len(reddit_keyword_map)
        linkedin_results = all_results[:n]
        twitter_results  = all_results[n:2*n]
        reddit_results   = all_results[2*n:2*n+nr]

        for platform_label, km, platform_results in [
            ("LinkedIn", keyword_map,        linkedin_results),
            ("Twitter",  keyword_map,        twitter_results),
            ("Reddit",   reddit_keyword_map, reddit_results),
        ]:
            for (category, keyword), posts in zip(km, platform_results):
                if isinstance(posts, Exception):
                    print(f"[Error] {platform_label} keyword='{keyword}': {posts}")
                    continue
                saved, scanned = _process_posts(posts, category, user_id, user_service, user_icp)
                results.extend(saved)
                total_scanned += scanned

    total_saved = len(results)
    print(f"[Ingestion] Done — scanned={total_scanned} saved={total_saved} rejected={total_scanned - total_saved}")
    return {"total_scanned": total_scanned, "total_saved": total_saved, "total_rejected": total_scanned - total_saved}
