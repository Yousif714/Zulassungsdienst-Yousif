#!/usr/bin/env python3
"""NEXUS Vimeo helper: list videos, fetch transcripts, search them, cut clips.

The Vimeo token is injected by the session's network proxy for api.vimeo.com,
so this script never handles the token itself. All HTTP goes through curl
(which honors HTTPS_PROXY); ffmpeg is pointed at the proxy explicitly.

Usage:
  vimeo.py list [--refresh]                 # all videos (cached in cache/videos.json)
  vimeo.py find <text>                      # videos whose title contains text
  vimeo.py transcript <video_id>            # print transcript with timestamps
  vimeo.py transcripts-all                  # cache every transcript (cache/tx/<id>.txt)
  vimeo.py search <text> [--context N]      # search all cached transcripts
  vimeo.py clip <video_id> <start> <dur> <out.mp4> [--quality 1080p]
                                            # start as seconds or HH:MM:SS(.ms)
  vimeo.py still <video_id> <time> <out.jpg># single frame
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get("NEXUS_VIMEO_CACHE", os.path.join(HERE, "..", "cache"))
API = "https://api.vimeo.com"
ACCEPT = "Accept: application/vnd.vimeo.*+json;version=3.4"
CA = "/root/.ccr/ca-bundle.crt"


def curl(url, accept=True, follow=False, redirect_only=False):
    cmd = ["curl", "-sS", "--fail-with-body"]
    if accept:
        cmd += ["-H", ACCEPT]
    if follow:
        cmd += ["-L"]
    if redirect_only:
        cmd += ["-o", "/dev/null", "-w", "%{redirect_url}"]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"HTTP-Fehler bei {url.split('?')[0]}: {r.stdout[:300]} {r.stderr[:300]}")
    return r.stdout


def api(path):
    return json.loads(curl(API + path))


def videos(refresh=False):
    os.makedirs(CACHE, exist_ok=True)
    f = os.path.join(CACHE, "videos.json")
    if os.path.exists(f) and not refresh:
        return json.load(open(f))
    out, page = [], 1
    fields = "uri,name,description,duration,created_time,link"
    while True:
        d = api(f"/me/videos?per_page=100&page={page}&sort=date&fields={fields}")
        out += d["data"]
        if not d.get("paging", {}).get("next"):
            break
        page += 1
    for v in out:
        v["id"] = v["uri"].rsplit("/", 1)[1]
    json.dump(out, open(f, "w"), ensure_ascii=False, indent=1)
    return out


def fmt(sec):
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}"


def parse_t(s):
    if re.fullmatch(r"[\d.]+", s):
        return float(s)
    parts = [float(p) for p in s.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def transcript(vid):
    os.makedirs(os.path.join(CACHE, "tx"), exist_ok=True)
    f = os.path.join(CACHE, "tx", f"{vid}.txt")
    if os.path.exists(f):
        return open(f).read()
    tracks = api(f"/videos/{vid}/texttracks").get("data", [])
    if not tracks:
        open(f, "w").write("")
        return ""
    tracks.sort(key=lambda t: (not t.get("active"), "autogen" in (t.get("language") or "")))
    vtt = curl(tracks[0]["link"], accept=False)
    lines, cur = [], None
    for line in vtt.splitlines():
        m = re.match(r"(\d+):(\d+):([\d.]+) -->", line) or re.match(r"(\d+):([\d.]+) -->", line)
        if m:
            g = [float(x) for x in m.groups()]
            cur = g[0] * 3600 + g[1] * 60 + g[2] if len(g) == 3 else g[0] * 60 + g[1]
        elif line.strip() and cur is not None and not line.strip().isdigit() and line != "WEBVTT":
            lines.append(f"[{fmt(cur)}] {line.strip()}")
            cur = None
    txt = "\n".join(lines)
    open(f, "w").write(txt)
    return txt


def play_url(vid, quality="1080p"):
    d = api(f"/videos/{vid}?fields=files.link,files.rendition,files.quality")
    files = [x for x in d.get("files", []) if x.get("link") and "hls" not in (x.get("quality") or "")]
    if not files:
        sys.exit("Keine Datei-Links (Video evtl. noch in Verarbeitung).")
    pick = next((x for x in files if quality in (x.get("rendition") or x["link"])), None) or files[0]
    return curl(pick["link"], accept=False, redirect_only=True) or pick["link"]


def ffmpeg_in(url, start):
    return ["ffmpeg", "-nostdin", "-loglevel", "error", "-http_proxy", os.environ.get("HTTPS_PROXY", ""),
            "-ca_file", CA, "-ss", str(start), "-i", url]


def main(a):
    if not a:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "list":
        for v in videos("--refresh" in a):
            print(v["id"], fmt(v["duration"]), v["created_time"][:10], v["name"])
    elif cmd == "find":
        q = " ".join(a[1:]).lower()
        for v in videos():
            if q in v["name"].lower():
                print(v["id"], fmt(v["duration"]), v["created_time"][:10], v["name"])
    elif cmd == "transcript":
        print(transcript(a[1]))
    elif cmd == "transcripts-all":
        vs = videos()
        for i, v in enumerate(vs, 1):
            t = transcript(v["id"])
            print(f"{i}/{len(vs)} {v['id']} {'ok' if t else 'kein Transkript'} {v['name'][:50]}", flush=True)
    elif cmd == "search":
        ctx = int(a[a.index("--context") + 1]) if "--context" in a else 1
        q = " ".join(x for x in a[1:] if x not in ("--context", str(ctx))).lower()
        names = {v["id"]: v["name"] for v in videos()}
        txdir = os.path.join(CACHE, "tx")
        for fn in sorted(os.listdir(txdir)) if os.path.isdir(txdir) else []:
            vid = fn[:-4]
            ls = open(os.path.join(txdir, fn)).read().splitlines()
            for i, l in enumerate(ls):
                if q in l.lower():
                    print(f"== {vid} | {names.get(vid, '?')}")
                    print("\n".join(ls[max(0, i - ctx): i + ctx + 1]))
    elif cmd == "clip":
        vid, start, dur, out = a[1], parse_t(a[2]), parse_t(a[3]), a[4]
        q = a[a.index("--quality") + 1] if "--quality" in a else "1080p"
        url = play_url(vid, q)
        subprocess.run(ffmpeg_in(url, start) + ["-t", str(dur), "-c:v", "libx264", "-preset", "fast", "-crf", "18",
                                                "-c:a", "aac", "-b:a", "192k", "-y", out], check=True)
        print(out)
    elif cmd == "still":
        vid, t, out = a[1], parse_t(a[2]), a[3]
        subprocess.run(ffmpeg_in(play_url(vid), t) + ["-frames:v", "1", "-q:v", "2", "-y", out], check=True)
        print(out)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
