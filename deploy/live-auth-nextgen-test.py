"""Production smoke test using root-only temporary credentials without printing them."""

from __future__ import annotations

import csv
import glob
import json
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE = "https://smart-tp-costing.5-223-78-194.sslip.io"


def request(opener, path: str, method: str = "GET", body: object | None = None):
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Origin": BASE}
    response = opener.open(Request(BASE + path, method=method, data=payload, headers=headers), timeout=90)
    raw = response.read().decode("utf-8", errors="replace")
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        data = {"raw": raw[:300]}
    return response.status, data


def summarize_bom(data: object):
    if not isinstance(data, dict):
        return 0, None
    candidates = [data.get("data"), data.get("results"), data.get("items")]
    nested = data.get("data")
    if isinstance(nested, dict):
        candidates.extend([nested.get("data"), nested.get("results"), nested.get("items"), nested.get("bomLines")])
    for candidate in candidates:
        if isinstance(candidate, list):
            return len(candidate), None
    return 0, data.get("error") or data.get("message")


def main():
    files = sorted(glob.glob("/root/tp_costing_initial_credentials_*.csv"))
    if not files:
        raise RuntimeError("No root-only credential file found")
    with Path(files[-1]).open(encoding="utf-8") as handle:
        users = list(csv.DictReader(handle))
    pbd = next(user for user in users if user["role"] == "pbd")

    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    login_status, login_data = request(opener, "/api/auth/login", "POST", {"username": pbd["email"], "password": pbd["temporary_password"]})
    print(f"pbd_login_status={login_status} role={login_data.get('role')}")

    anonymous = build_opener(HTTPCookieProcessor(CookieJar()))
    try:
        anonymous_status, _ = request(anonymous, "/api/costing/requests")
    except Exception as error:
        anonymous_status = getattr(error, "code", 0)
    print(f"anonymous_protected_status={anonymous_status}")

    for style in ["M8836232", "M88118568", "M8836021"]:
        status, data = request(opener, "/api/nextgen/bom/search?" + urlencode({"styleNumber": style}))
        count, error = summarize_bom(data)
        ok = isinstance(data, dict) and bool(data.get("ok"))
        print(f"style={style} http={status} ok={ok} bom_lines={count} error={str(error)[:120] if error else 'none'}")


if __name__ == "__main__":
    main()
