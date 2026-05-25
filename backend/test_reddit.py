import httpx
import asyncio

HEADERS = {"User-Agent": "cnvrted/1.0"}

async def test_reddit(keyword: str):
    url = f"https://www.reddit.com/search.json?q={keyword}&sort=new&limit=10&t=week"
    async with httpx.AsyncClient(headers=HEADERS, timeout=30) as client:
        resp = await client.get(url)
        print(f"Status: {resp.status_code}")
        if resp.status_code != 200:
            print(f"Error: {resp.text[:200]}")
            return

        data = resp.json()
        posts = data.get("data", {}).get("children", [])
        print(f"Posts returned: {len(posts)}\n")
        for i, post in enumerate(posts[:5], 1):
            p = post["data"]
            print(f"--- Post {i} ---")
            print(f"Title   : {p.get('title', '')}")
            print(f"Body    : {p.get('selftext', '')[:100]}")
            print(f"Author  : {p.get('author', '')}")
            print(f"Subreddit: r/{p.get('subreddit', '')}")
            print(f"URL     : https://reddit.com{p.get('permalink', '')}")
            print()

asyncio.run(test_reddit("looking for marketing agency"))
