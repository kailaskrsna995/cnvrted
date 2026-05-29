import httpx
import hashlib
import asyncio
from app.config import APIFY_API_TOKEN
from app.database import supabase
from app.scorer import score_post, generate_outreach
from typing import Optional, List

KEYWORDS = {
    "AI Filmmaking": [
        "can anyone recommend AI video production",
        "looking for AI filmmaking studio",
        "need help with AI generated video",
        "anyone used a good AI video agency",
        "we need AI video content for our brand",
        "looking to outsource AI video production",
    ],
    "AI Automation": [
        "can anyone recommend AI automation agency",
        "looking for automation consultant",
        "need help automating our workflows",
        "anyone used a good AI agency",
    ],
    "Paid Social": [
        "can anyone recommend paid ads agency",
        "who do you use for Facebook ads",
        "looking for a good media buyer",
        "need help with our paid social",
    ],
    "Marketing": [
        "can anyone recommend marketing agency",
        "looking for a good growth agency",
        "need help with our marketing strategy",
        "who do you recommend for lead generation",
    ],
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
    # NOTE: LinkedIn's search ignores quote syntax, so phrase-quoting just
    # shrinks the result pool without improving precision. We instead send the
    # plain buyer-framed phrase to surface the widest set of candidate posts,
    # then let the LLM scorer (score_post + qualified gate) decide which are
    # genuine buyers. past-month casts a wide net for rare buyer posts.
    return (
        "https://www.linkedin.com/search/results/content/"
        f"?datePosted=%22past-month%22&keywords={quote(keyword)}"
        "&origin=FACETED_SEARCH&sortBy=%22date_posted%22"
    )

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

    # Step 2: poll until finished. 40 × 5s = 200s — the LinkedIn actor can be
    # slow; a 120s window made some runs give up while still RUNNING (saved=0).
    status = ""
    for _ in range(40):
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
# IMPORTANT: Keep this list tight. False positives here silently kill real buyer posts.
# "our agency" / "my agency" intentionally excluded — agency owners can be buyers.
# "dm me" / "reach out" excluded — buyers use these too ("DM me your recommendations").
SELLER_SIGNALS = [
    "i built this", "i created this",
    "we specialize in", "i offer",
    "check out my", "here's how i", "i helped a client",
    "book a call", "schedule a call", "free consultation", "link in bio",
    "i specialize in",
    "my services", "hire us",
    "contact us today",
    # NOTE: "we offer" / "our team offers" removed — they collide with company
    # hiring posts ("we offer competitive pay/benefits"), which are now leads.
    # Genuine sellers are still caught by the LLM scorer's bucket A.
    # Seller launch / self-promotion patterns
    "officially open", "now open for", "open for clients", "open for projects",
    "available for hire", "available for projects", "available for freelance",
    "dm for paid", "dm for orders", "dms open for",
    "portfolio:", "my portfolio", "my rates", "pricing:", "starting from $",
    "freelance services", "editing services",
    "excited to launch", "excited to announce", "just launched my",
    "service promo", "promo post",
    "i do this", "i do that", "i can help you",
    "i'm a video editor", "i am a video editor",
    "i'm an editor", "i am an editor",
]

# Job listings — companies hiring employees, not buying agency services
# Keep this tight — false positives here silently discard real buyer posts
JOB_LISTING_SIGNALS = [
    "we're hiring", "we are hiring", "now hiring", "#hiring",
    "join our team", "job opening",
    "open position", "apply now", "apply here",
    "send your cv", "send your resume", "send cv", "send resume",
    "job description", "responsibilities:", "salary:",
    "internship",
]

# Tight buyer-intent phrases — people actively seeking to PAY someone externally.
# These are specific enough that sellers rarely use them as content hooks.
# Used as a pre-LLM gate: posts with NONE of these are skipped before scoring.
BUYER_PHRASES = [
    # Classic recommendation-seeking
    "can anyone recommend",
    "anyone recommend",
    "anyone know a good",
    "does anyone know a good",
    "has anyone worked with",
    "has anyone used",
    "have you worked with",
    "have you used a good",
    "does anyone have a recommendation",
    "anyone have a recommendation",
    "any recommendations for",
    "looking for recommendations",
    "can someone recommend",
    "who do you recommend",
    "who do you use for",
    "who would you recommend",
    "what agency do you",
    "any good agencies",
    "know any good",
    "recommend a good",
    "recommend an agency",
    "recommend a freelancer",
    # Active search
    "looking to hire",
    "want to hire",
    "need to hire",
    "looking to outsource",
    "need to outsource",
    "looking for a good",
    "looking for an agency",
    "looking for a freelancer",
    "looking for someone to",
    "we're looking for",
    "we are looking for",
    "i'm looking for a",
    "i am looking for a",
    "our company is looking",
    "our team is looking",
    "searching for a good",
    "searching for an agency",
    # Need-based
    "need help finding",
    "need help with our",
    "we need a",
    "we need help",
    "i need a",
    "our company needs",
    "our team needs",
    "need a good",
    "need an agency",
    # Budget/vendor signals
    "seeking a vendor",
    "seeking a partner",
    "budget approved",
    "willing to pay",
]


# Buyer-intent openers — if a keyword already starts with one of these,
# LinkedIn's search will surface posts from real buyers.
# Used by _make_linkedin_buyer_query() to wrap bare topic keywords.
_BUYER_OPENERS = (
    "can anyone", "anyone used", "anyone know", "anyone recommend",
    "has anyone", "have you used", "does anyone",
    "looking for", "looking to", "we are looking", "we're looking",
    "i am looking", "i'm looking", "our team is looking", "our company is looking",
    "we need", "i need", "need a ", "need an ", "need to ", "need help", "need someone",
    "need more", "need better", "need fresh", "need ugc", "need video", "need ad",
    "our team needs", "our company needs",
    "running out", "struggling with", "struggling to", "can't keep up", "cant keep up",
    "bottlenecked", "overwhelmed", "roas drop", "ad fatigue", "creative fatigue",
    "who do you", "who would you", "what agency", "what do you",
    "recommend", "recommendation",
    "searching for", "seeking a", "seeking an",
    "want to hire", "looking to outsource",
    # Verb-first buyer phrases Claude commonly generates
    "outsource ", "hire a", "hire an", "find a", "find an",
)


def _make_linkedin_buyer_query(keyword: str) -> str:
    """Ensure a keyword is phrased as a buyer query before sending to LinkedIn search.

    LinkedIn's search surfaces buyer posts when the query matches the language
    real buyers use. Bare topic keywords ("video production agency") return seller
    content and educational posts. Buyer-framed queries ("can anyone recommend
    video production agency") surface people actively seeking to hire.
    """
    lower = keyword.lower().strip()
    # If the keyword already starts with a known buyer opener — leave it
    if any(lower.startswith(s) for s in _BUYER_OPENERS):
        return keyword
    # If the keyword contains any buyer phrase anywhere — leave it
    if any(phrase in lower for phrase in BUYER_PHRASES):
        return keyword
    # Bare topic keyword — prepend buyer framing
    return f"can anyone recommend {keyword}"


def _make_reddit_search_query(keyword: str) -> str:
    """
    Strip buyer-intent openers from a keyword phrase so Reddit's tokenised
    search matches on the core topic nouns, not the conversational framing.

    Reddit search can't handle 10-word natural-language phrases — it tokenises
    them and returns any post that contains any of the words, producing noise.
    Keeping 3–5 topic words ("video ad agency Meta TikTok") returns on-topic
    posts from buyer-intent subreddits.

    Examples
    --------
    "can anyone recommend a video ad agency for Meta and TikTok campaigns"
        → "video ad agency Meta TikTok"
    "struggling to scale video ads for Meta and TikTok looking for a production partner"
        → "scale video ads Meta TikTok"
    "running out of video ad creatives for paid campaigns need an agency fast"
        → "video ad creatives paid campaigns"
    """
    lower = keyword.lower()

    # Strip leading buyer-intent openers — longest first so partial prefixes
    # don't shadow full ones ("can anyone recommend a" vs "can anyone recommend")
    _STRIP_OPENERS = [
        "can anyone recommend a ", "can anyone recommend an ", "can anyone recommend ",
        "anyone used a good ", "anyone know a good ", "anyone recommend a ",
        "anyone recommend an ", "anyone recommend ",
        "does anyone know a good ", "does anyone know ",
        "has anyone used a good ", "has anyone used ", "has anyone worked with ",
        "who do you use for ", "who do you recommend for ", "who would you recommend ",
        "looking to hire a ", "looking to hire an ", "looking to hire ",
        "looking for a good ", "looking for an ", "looking for a ", "looking for ",
        "we are looking for a ", "we're looking for a ", "i'm looking for a ",
        "i am looking for a ", "our company is looking for ", "our team is looking for ",
        "we need a ", "we need an ", "we need ",
        "i need a ", "i need an ",
        "struggling to scale ", "struggling to ", "struggling with ",
        "running out of ", "ran out of ",
        "can't keep up with ", "cant keep up with ", "can't keep up ", "cant keep up ",
        "drowning in ", "falling behind on ", "falling behind ",
        "stretched thin on ", "overwhelmed with ", "overwhelmed by ",
        "tired of ", "fed up with ", "behind on ",
        "want to hire a ", "want to hire an ", "want to hire ",
        "searching for a ", "searching for an ",
        "seeking a ", "seeking an ",
        "scaling our ", "scaling up ", "ramping up our ", "ramping up ",
        "doubling down on ", "expanding into ", "launching our ", "launching ",
    ]
    for opener in _STRIP_OPENERS:
        if lower.startswith(opener):
            keyword = keyword[len(opener):]
            lower = keyword.lower()
            break

    # Strip leading article
    for art in ("the ", "a ", "an "):
        if lower.startswith(art):
            keyword = keyword[len(art):]
            lower = keyword.lower()
            break

    # Strip common trailing filler phrases
    _STRIP_SUFFIXES = [
        " looking for a production partner", " looking for production partner",
        " looking for an agency", " looking for agency",
        " need an agency fast", " need an agency", " need agency",
        " for our paid social campaigns", " for paid social campaigns",
        " for paid campaigns", " for our brand",
        " to create ads for meta tiktok and youtube",
        " to create ads", " create ads for us",
        " for us fast", " fast",
    ]
    for suffix in _STRIP_SUFFIXES:
        if lower.endswith(suffix.lower()):
            keyword = keyword[: len(keyword) - len(suffix)]
            lower = keyword.lower()
            break

    # Keep at most 3 words — Reddit tokenises queries, so 4-5 specific words
    # often return 0 posts. 2-3 focused nouns hit enough posts while staying
    # on-topic. The LLM scorer handles relevance from there.
    words = keyword.split()
    _STOP = {"for", "and", "or", "the", "a", "an", "to", "of", "our",
             "with", "in", "on", "at", "by", "from", "us", "we", "create",
             "both", "all", "any", "my", "your", "their", "its",
             # verbs / state words — never the topic, only conversational framing
             "is", "are", "be", "im", "i'm", "cant", "can't", "keep", "up",
             "out", "down", "behind", "really", "just", "getting", "into",
             # pain adjectives / verbs — strip so the topic noun survives
             "drowning", "struggling", "running", "ran", "stretched", "thin",
             "inconsistent", "falling", "overwhelmed", "tired", "fed",
             "scaling", "ramping", "doubling", "expanding", "launching"}
    clean = [w for w in words if w.lower() not in _STOP]
    # Take the first 3 meaningful words
    result = " ".join(clean[:3]).strip()
    return result or keyword.split()[0]


def _is_english(text: str) -> bool:
    letters = [c for c in text if c.isalpha()]
    if not letters:
        return False
    return sum(1 for c in letters if ord(c) < 128) / len(letters) > 0.8


def _has_buying_signal(text: str, require_buyer_phrase: bool = False) -> bool:
    """
    Two-stage gate:
    1. Reject posts that are clearly not buyers (job seekers, sellers, job listings).
    2. If require_buyer_phrase=True, also require at least one explicit buyer phrase.
       Use this for noisy sources (LinkedIn) where seller content is rampant.
       The LLM is then only called on posts that already look like buyers.
    """
    lower = text.lower()
    if any(sig in lower for sig in JOB_SEEKER_SIGNALS):
        return False
    if any(sig in lower for sig in SELLER_SIGNALS):
        print(f"[Filter] Seller signal: {text[:80]}")
        return False
    # NOTE: hiring posts are intentionally NOT gated here. A company hiring for a
    # role has budget + an active need an agency could fulfil, so we let these
    # reach the LLM scorer, which judges them as buyers (see scorer SYSTEM_PROMPT).
    if require_buyer_phrase and not any(phrase in lower for phrase in BUYER_PHRASES):
        print(f"[Filter] No buyer phrase: {text[:80]}")
        return False
    return True


def _process_posts(posts: list, category: str, user_id: Optional[str], user_service: str = "", user_icp: str = "", skip_scoring: bool = False, max_posts: Optional[int] = None, require_buyer_phrase: bool = False, seen_ids: Optional[set] = None) -> tuple:
    results = []
    total_scanned = 0
    for post in posts:
        if max_posts is not None and len(results) >= max_posts:
            break
        total_scanned += 1
        try:
            text = post.get("text", "")
            if not text or len(text) < 50:
                continue
            if not _is_english(text):
                print(f"[Filter] Non-English: {text[:60]}")
                continue
            if not _has_buying_signal(text, require_buyer_phrase=require_buyer_phrase):
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

            if skip_scoring:
                scored = {
                    "category": category or "Uncategorised",
                    "intent_score": 50,
                    "timeline": "Active",
                    "qualified": True,
                    "exact_need": "",
                    "domain": "",
                    "contact_email": "",
                    "contact_phone": "",
                    "tokens_used": 0,
                }
                outreach_line = ""
            else:
                scored = score_post(text, category_hint=category, user_service=user_service)
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

            # Drop Twitter posts older than 90 days (matches the 90d fetch window)
            if post.get("_platform") == "twitter":
                drop = True
                if posted_at:
                    try:
                        from datetime import datetime as _dt2
                        age_days = (_dt2.utcnow() - _dt2.fromisoformat(posted_at)).days
                        if age_days <= 90:
                            drop = False
                        else:
                            print(f"[Filter] Twitter post too old ({age_days}d): {text[:60]}")
                    except Exception as e:
                        print(f"[Filter] Twitter date parse failed ({posted_at}): {e}")
                if drop:
                    continue

            # Drop LinkedIn posts older than 30 days
            if post.get("_platform", "linkedin") == "linkedin" and posted_at:
                try:
                    from datetime import datetime as _dt3
                    age_days = (_dt3.utcnow() - _dt3.fromisoformat(posted_at)).days
                    if age_days > 60:
                        print(f"[Filter] LinkedIn post too old ({age_days}d): {text[:60]}")
                        continue
                except Exception:
                    pass

            lead_id = generate_lead_id(url, text, author)
            # Skip if we've already saved this exact post in this scan run
            if seen_ids is not None:
                if lead_id in seen_ids:
                    print(f"[Dedup] Skipping duplicate lead_id={lead_id[:8]} | {text[:60]}")
                    continue
                seen_ids.add(lead_id)
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
    # 50 × 5s = 250s. The Reddit actor uses a residential proxy and is slow —
    # a 120s window made 2 of 3 runs give up while still RUNNING (the demo's
    # best buyer source). Give it room to finish.
    for _ in range(50):
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
    "entrepreneur+smallbusiness+startups+SaaS"
    "+businessowners+ecommerce+marketing+Entrepreneur"
    "+smallbusinessowners+growmybusiness+agency"
)
# Removed: forhire (sellers advertising themselves), freelance (same problem),
# hiring (employee job posts), digitalnomad (off topic), webdev (too technical)

async def fetch_reddit_results(client: httpx.AsyncClient, keyword: str) -> list:
    from urllib.parse import quote
    # Strip buyer-intent openers — Reddit tokenises long phrases and returns noise.
    # Short topic-noun queries ("video ad agency Meta TikTok") return on-topic posts.
    search_query = _make_reddit_search_query(keyword)
    print(f"[Reddit] query='{search_query}' (from keyword: '{keyword[:60]}')")
    # Restrict to buyer-intent subreddits; t=year gives more results than t=month
    search_url = (
        f"https://www.reddit.com/r/{BUYER_SUBREDDITS}/search/"
        f"?q={quote(search_query)}&sort=new&t=year&restrict_sr=1&type=link"
    )
    raw_items = await _run_apify_actor(client, REDDIT_ACTOR, {
        "startUrls": [{"url": search_url}],
        "searchPosts": True,
        "searchComments": False,
        "searchCommunities": False,
        "maxPostsCount": 30,
        "fastMode": True,
        "includeNSFW": False,
        "crawlCommentsPerPost": False,
        "proxy": {"useApifyProxy": True, "apifyProxyGroups": ["RESIDENTIAL"]},
    }, "Reddit")
    print(f"[Reddit] '{search_query}' returned {len(raw_items)} posts")
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


async def fetch_google_linkedin_posts(client: httpx.AsyncClient, keyword: str) -> list:
    """Use Google (via Serper) to find LinkedIn posts containing the exact keyword.
    Google indexes public LinkedIn posts and ranks by content relevance — not engagement.
    This surfaces low-engagement buyer recommendation posts that LinkedIn's own search buries.
    """
    from app.config import SERPER_API_KEY
    if not SERPER_API_KEY:
        print(f"[Google] No SERPER_API_KEY — skipping")
        return []

    # Don't exact-match the full keyword phrase — buyer posts rarely repeat it verbatim.
    # Instead quote just the core 3-word buyer-intent opener and add domain words unquoted.
    parts = keyword.split()
    # Find the first buyer phrase (up to first 3-4 words) and keep the rest free
    buyer_starters = ("can anyone", "looking for", "need help", "anyone used", "we need", "who do you", "looking to")
    core_quoted = keyword
    for starter in buyer_starters:
        if keyword.lower().startswith(starter):
            # Quote just the opener + 1 more word; rest unquoted
            end = len(starter.split()) + 1
            core_quoted = f'"{" ".join(parts[:end])}" {" ".join(parts[end:])}'
            break
    query = f'site:linkedin.com/posts {core_quoted}'
    print(f"[Google] query: {query}")
    try:
        resp = await client.post(
            "https://google.serper.dev/search",
            headers={"X-API-KEY": SERPER_API_KEY, "Content-Type": "application/json"},
            json={"q": query, "num": 20, "hl": "en"},
            timeout=15,
        )
        if resp.status_code != 200:
            print(f"[Google] Serper error {resp.status_code}: {resp.text[:200]}")
            return []

        data = resp.json()
        results = data.get("organic", [])
        print(f"[Google] '{keyword}' → {len(results)} results")

        posts = []
        for r in results:
            url = r.get("link", "")
            if "linkedin.com/posts" not in url and "linkedin.com/feed" not in url:
                continue
            # Snippet contains post preview text — enough to score
            title   = r.get("title", "")
            snippet = r.get("snippet", "")
            text    = f"{title}\n{snippet}".strip()
            if not text or len(text) < 40:
                continue
            # Extract author from title (LinkedIn title format: "Name on LinkedIn: ...")
            author = title.split(" on LinkedIn")[0].strip() if " on LinkedIn" in title else "LinkedIn User"
            posts.append({
                "text": text,
                "author": {
                    "firstName": author,
                    "lastName": "",
                    "occupation": "",
                    "publicId": "",
                },
                "url": url,
                "postedAt": None,
                "_platform": "linkedin",
                "_source": "google",
            })
        return posts

    except Exception as e:
        print(f"[Google] Error for '{keyword}': {e}")
        return []


async def fetch_twitter_results(client: httpx.AsyncClient, keyword: str) -> list:
    from datetime import datetime as _dt, timedelta as _td
    since_date = (_dt.utcnow() - _td(days=90)).strftime("%Y-%m-%d")
    # Twitter search also tokenises — long sentences match nothing. Use the same
    # short topic-core extraction we use for Reddit.
    search_query = _make_reddit_search_query(keyword)
    print(f"[Twitter] query='{search_query}' (from keyword: '{keyword[:60]}')")
    raw_items = await _run_apify_actor(client, TWITTER_ACTOR, {
        "searchTerms": [search_query],
        "sort": "Latest",
        "tweetLanguage": "en",
        "maxItems": 40,
        "since": since_date,
    }, "Twitter")
    print(f"[Twitter] '{search_query}' returned {len(raw_items)} posts")
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
    service_override: Optional[str] = None,
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

    # Prefer service passed from the current chat session over the static DB value.
    # Each scan can carry a fresh description of what the user sells so the niche
    # filter in scorer.py disqualifies off-topic leads correctly.
    if service_override:
        user_service = service_override
        print(f"[Ingestion] Service overridden from scan request: '{user_service}'")

    if custom_keywords:
        keyword_map = [(domain or "Custom", kw) for kw in custom_keywords]
    else:
        keyword_map = [(cat, kw) for cat, kws in KEYWORDS.items() for kw in kws]

    # Use first 3 keywords only for Reddit/Twitter to avoid too many Apify runs
    social_keyword_map = keyword_map[:3]

    # Caps — Reddit and Twitter capped so they don't dominate the feed
    REDDIT_CAP = 15
    TWITTER_CAP = 15

    print(f"[Ingestion] Keywords: {[kw for _, kw in keyword_map]}")
    print(f"[Ingestion] User context — service='{user_service}' icp='{user_icp}'")
    results = []
    total_scanned = 0
    async with httpx.AsyncClient(timeout=300) as client:
        from app.config import SERPER_API_KEY

        # LinkedIn: 2 buyer-framing queries (PRIORITY — explicit agency-hire asks) +
        # 1 hiring-role query (FILLER — companies hiring for a relevant role; scorer
        # distinguishes brand hires = buyers vs. agency internal hires = low score).
        li_queries = (
            [_make_linkedin_buyer_query(kw) for _, kw in keyword_map[:2]] +
            [f"hiring {_make_reddit_search_query(kw)}" for _, kw in keyword_map[2:3]]
        )
        linkedin_tasks = [fetch_apify_results(client, q) for q in li_queries]
        print(f"[Ingestion] LinkedIn queries: {li_queries}")

        # Google/Serper LinkedIn — disabled until paid Serper plan (free plan blocks site: queries)
        google_tasks = []

        # Reddit removed — kept functions for future use if needed
        twitter_tasks  = [fetch_twitter_results(client, kw) for _, kw in social_keyword_map]

        all_results = await asyncio.gather(
            *linkedin_tasks, *google_tasks, *twitter_tasks,
            return_exceptions=True
        )

        n_li = len(linkedin_tasks)
        n_go = len(google_tasks)
        linkedin_results = all_results[:n_li]
        google_results   = all_results[n_li:n_li + n_go]
        twitter_results  = all_results[n_li + n_go:]

        # Shared dedup set — prevents the same post being scored/saved more than once
        # across all platforms and keyword results within a single scan run.
        _seen_lead_ids: set = set()

        # LinkedIn (Apify) — hard seller/job filters + LLM scoring decide.
        # We do NOT require an exact buyer phrase: LinkedIn returns content posts
        # that the rigid phrase list zeroed out (saved=0). Letting the LLM scorer
        # judge buyer intent lets genuine buyers with varied wording through while
        # content/sellers get scored low and dropped by the `qualified` gate.
        for (category, keyword), posts in zip(keyword_map, linkedin_results):
            if isinstance(posts, Exception):
                print(f"[Error] LinkedIn keyword='{keyword}': {posts}")
                continue
            saved, scanned = _process_posts(
                posts, category, user_id,
                user_service=user_service, user_icp=user_icp,
                require_buyer_phrase=False,
                max_posts=8,
                seen_ids=_seen_lead_ids,
            )
            results.extend(saved)
            total_scanned += scanned

        # LinkedIn (Google/Serper) — already searched with buyer phrases, skip phrase gate
        for (category, keyword), posts in zip(keyword_map, google_results):
            if isinstance(posts, Exception):
                print(f"[Error] Google LinkedIn keyword='{keyword}': {posts}")
                continue
            saved, scanned = _process_posts(
                posts, category, user_id,
                user_service=user_service, user_icp=user_icp,
                require_buyer_phrase=False,
                seen_ids=_seen_lead_ids,
            )
            results.extend(saved)
            total_scanned += scanned

        # Twitter — LLM scored, capped at TWITTER_CAP to control cost
        twitter_posts_all = []
        _twitter_seen_urls: set = set()
        _twitter_seen_texts: set = set()   # catches same-content spam at different URLs
        for (category, keyword), posts in zip(social_keyword_map, twitter_results):
            if isinstance(posts, Exception):
                print(f"[Error] Twitter keyword='{keyword}': {posts}")
                continue
            for p in posts:
                url = p.get("url", "")
                if url and url in _twitter_seen_urls:
                    continue
                # Dedup by text prefix — spam bots post identical content at many URLs
                text_key = (p.get("text", "") or p.get("fullText", ""))[:80].strip()
                if text_key and text_key in _twitter_seen_texts:
                    continue
                if url:
                    _twitter_seen_urls.add(url)
                if text_key:
                    _twitter_seen_texts.add(text_key)
                p["_category"] = category
                twitter_posts_all.append(p)
        if twitter_posts_all:
            saved, scanned = _process_posts(
                twitter_posts_all, domain or "Custom", user_id,
                seen_ids=_seen_lead_ids,
                max_posts=TWITTER_CAP,
                user_service=user_service, user_icp=user_icp,
            )
            results.extend(saved)
            total_scanned += scanned
            print(f"[Twitter] saved={len(saved)} from {scanned} scanned (cap={TWITTER_CAP})")

    total_saved = len(results)
    print(f"[Ingestion] Done — scanned={total_scanned} saved={total_saved} rejected={total_scanned - total_saved}")
    return {"total_scanned": total_scanned, "total_saved": total_saved, "total_rejected": total_scanned - total_saved}
