#!/usr/bin/env python3
"""Minimal MuAPI client (api.muapi.ai) for AI image/video generation.

Auth: header `x-api-key`. In the cloud environment the key is a network secret
for api.muapi.ai injected by the proxy, so we send a placeholder value that the
proxy overwrites. Locally, set MUAPI_KEY.

Pattern: POST /api/v1/<endpoint> {json} -> {request_id}
         GET  /api/v1/predictions/<request_id>/result  until status completed/failed
         result URL: result.outputs[0] (or result.url)

Usage:
  muapi.py estimate <endpoint> '<json>'          # cost estimate (no charge)
  muapi.py run <endpoint> '<json>' [out_file]    # submit, poll, download result
  muapi.py upload <local_file>                   # -> hosted URL for image_url etc.
  muapi.py result <request_id> [out_file]        # resume polling an earlier job
"""
import json
import os
import subprocess
import sys
import time

BASE = "https://api.muapi.ai/api/v1"
KEY = os.environ.get("MUAPI_KEY", "proxy-injected")
OK = {"completed", "succeeded", "success"}
BAD = {"failed", "error", "cancelled", "canceled"}


def curl(args):
    r = subprocess.run(["curl", "-sS", "-H", f"x-api-key: {KEY}"] + args, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"curl-Fehler: {r.stderr[:300]}")
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        sys.exit(f"Keine JSON-Antwort: {r.stdout[:300]}")


def post(path, payload):
    return curl(["-X", "POST", "-H", "Content-Type: application/json", "-d", json.dumps(payload), f"{BASE}/{path}"])


def output_url(res):
    outs = res.get("outputs") or []
    if outs:
        o = outs[0]
        return o if isinstance(o, str) else (o.get("url") or o.get("video") or o.get("image"))
    return res.get("url") or res.get("video_url") or res.get("image_url")


def poll(rid, timeout=1800, every=4):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(every)
        res = curl([f"{BASE}/predictions/{rid}/result"])
        st = (res.get("status") or "").lower()
        if st in OK:
            return res
        if st in BAD:
            sys.exit(f"Job {rid} fehlgeschlagen: {res.get('error') or res}")
        print(f"  {rid}: {st or 'wartet'} ({int(time.time() - t0)} s)", file=sys.stderr, flush=True)
    sys.exit(f"Timeout. Später fortsetzen mit: muapi.py result {rid}")


def download(url, out):
    subprocess.run(["curl", "-sSL", "-o", out, url], check=True)
    print(out)


def main(a):
    if len(a) < 2:
        sys.exit(__doc__)
    cmd = a[0]
    if cmd == "estimate":
        print(json.dumps(post(f"models/{a[1]}/estimate-cost", json.loads(a[2])), indent=1))
    elif cmd == "run":
        sub = post(a[1], json.loads(a[2]))
        rid = sub.get("request_id") or sub.get("id")
        if not rid:
            sys.exit(f"Kein request_id: {sub}")
        print(f"request_id {rid}", file=sys.stderr)
        res = poll(rid)
        url = output_url(res)
        print(url)
        if len(a) > 3 and url:
            download(url, a[3])
    elif cmd == "result":
        res = poll(a[1])
        url = output_url(res)
        print(url)
        if len(a) > 2 and url:
            download(url, a[2])
    elif cmd == "upload":
        res = curl(["-X", "POST", "-F", f"file=@{a[1]}", f"{BASE}/upload_file"])
        print(res.get("url") or res.get("file_url") or (res.get("data") or {}).get("url") or res)
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
