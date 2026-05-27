import httpx

headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}

feeds = [
    "https://www.indiehackers.com/feed.xml",
    "https://www.indiehackers.com/rss.xml",
    "https://www.indiehackers.com/feed",
    "https://www.indiehackers.com/rss",
    "https://www.indiehackers.com/ask.rss",
    "https://www.indiehackers.com/posts.rss",
]

with httpx.Client(timeout=10, headers=headers, follow_redirects=True) as c:
    for url in feeds:
        r = c.get(url)
        ct = r.headers.get("content-type", "")
        snippet = r.text[:200].replace("\n", " ")
        is_xml = "xml" in ct or snippet.strip().startswith("<?xml") or "<rss" in snippet
        print(f"{r.status_code}  {'RSS/XML' if is_xml else 'HTML'}  {url}")
        if is_xml:
            print(f"       {snippet}")
