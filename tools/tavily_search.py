#!/usr/bin/env python3
"""Tavily web search cho Lucy — đỡ tốn token Claude cho task tìm kiếm.

Usage:
  tavily_search.py "query" [--deep] [--n 5] [--raw]
    --deep : search_depth=advanced + include_answer (deep research)
    --n    : số kết quả (default 5, max 10)
    --raw  : in JSON gốc thay vì format nén

Key đọc từ env TAVILY_API_KEY, fallback /root/lucy/.env.
Output mặc định: format nén (answer + title/url/snippet) để đút thẳng vào context.
"""
import json
import os
import sys
import urllib.request

ENV_FILE = "/root/lucy/.env"
API_URL = "https://api.tavily.com/search"


def get_key() -> str:
    key = os.environ.get("TAVILY_API_KEY", "").strip()
    if key:
        return key
    try:
        with open(ENV_FILE) as f:
            for line in f:
                line = line.strip()
                if line.startswith("TAVILY_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except OSError:
        pass
    print("ERR: TAVILY_API_KEY không có trong env lẫn " + ENV_FILE, file=sys.stderr)
    sys.exit(2)


def search(query: str, deep: bool, n: int) -> dict:
    payload = {
        "api_key": get_key(),
        "query": query,
        "search_depth": "advanced" if deep else "basic",
        "include_answer": deep,
        "max_results": max(1, min(n, 10)),
    }
    req = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.load(resp)


def main() -> None:
    args = sys.argv[1:]
    if not args or args[0] in ("-h", "--help"):
        print(__doc__)
        sys.exit(0)
    deep = "--deep" in args
    raw = "--raw" in args
    n = 5
    if "--n" in args:
        i = args.index("--n")
        n = int(args[i + 1])
        del args[i : i + 2]
    query = " ".join(a for a in args if not a.startswith("--"))
    try:
        d = search(query, deep, n)
    except Exception as e:  # fail-loud, không nuốt lỗi
        print(f"ERR: tavily fail: {e}", file=sys.stderr)
        sys.exit(1)
    if raw:
        json.dump(d, sys.stdout, ensure_ascii=False, indent=1)
        return
    ans = d.get("answer")
    if ans:
        print(f"ANSWER: {ans}\n")
    for r in d.get("results", []):
        snippet = (r.get("content") or "").replace("\n", " ")[:280]
        print(f"- {r.get('title', '?')}\n  {r.get('url', '?')}\n  {snippet}\n")


if __name__ == "__main__":
    main()
