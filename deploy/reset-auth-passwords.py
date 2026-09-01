"""Reset active tp_costing Auth users to an explicitly supplied QA password."""
from __future__ import annotations

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

BASE_URL = "http://127.0.0.1:8000"


def load_env():
    values = {}
    for line in Path("/opt/supabase/docker/.env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def call(method, path, key, body=None, profile=None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if profile:
        headers["Accept-Profile"] = profile
        headers["Content-Profile"] = profile
    request = Request(BASE_URL + path, method=method, headers=headers, data=json.dumps(body).encode() if body else None)
    with urlopen(request, timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else None


def main():
    password = os.environ.get("TP_RESET_PASSWORD")
    if not password or len(password) < 8:
        raise RuntimeError("TP_RESET_PASSWORD must be supplied and at least 8 characters")
    key = load_env().get("SERVICE_ROLE_KEY") or load_env().get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise RuntimeError("Service role key not found")
    profiles = call("GET", "/rest/v1/user_profiles?select=auth_user_id,is_active&is_active=eq.true&auth_user_id=not.is.null", key, profile="tp_costing")
    changed = 0
    for profile in profiles or []:
        user_id = profile.get("auth_user_id")
        if user_id:
            call("PUT", f"/auth/v1/admin/users/{user_id}", key, {"password": password})
            changed += 1
    print(f"password_reset_count={changed}")


if __name__ == "__main__":
    main()
