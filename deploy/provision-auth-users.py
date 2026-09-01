"""Provision active tp_costing profiles in self-hosted Supabase Auth.

Temporary passwords are written only to a root-readable CSV on the VPS.
The script never prints credentials.
"""

from __future__ import annotations

import csv
import json
import os
import secrets
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

SUPABASE_ENV = Path("/opt/supabase/docker/.env")
BASE_URL = "http://127.0.0.1:8000"


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def api(method: str, path: str, key: str, body: object | None = None, profile: str | None = None):
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    if profile:
        headers["Accept-Profile"] = profile
        headers["Content-Profile"] = profile
    request = Request(
        BASE_URL + path,
        method=method,
        headers=headers,
        data=json.dumps(body).encode("utf-8") if body is not None else None,
    )
    try:
        with urlopen(request, timeout=30) as response:
            payload = response.read()
            return json.loads(payload) if payload else None
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"{method} {path} failed with HTTP {error.code}: {detail[:500]}") from error


def main() -> int:
    env = load_env(SUPABASE_ENV)
    service_key = env.get("SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY")
    if not service_key:
        raise RuntimeError("Supabase service role key was not found")

    profiles = api(
        "GET",
        "/rest/v1/user_profiles?select=id,email,display_name,role,auth_user_id&is_active=eq.true&order=role.asc",
        service_key,
        profile="tp_costing",
    )
    if not isinstance(profiles, list):
        raise RuntimeError("Unexpected user profile response")

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    credentials_path = Path(f"/root/tp_costing_initial_credentials_{stamp}.csv")
    created: list[tuple[str, str, str]] = []
    linked = 0

    for profile in profiles:
        if profile.get("auth_user_id"):
            linked += 1
            continue
        email = str(profile.get("email") or "").strip().lower()
        if not email:
            continue
        password = secrets.token_urlsafe(18) + "A9!"
        auth_user = api(
            "POST",
            "/auth/v1/admin/users",
            service_key,
            {
                "email": email,
                "password": password,
                "email_confirm": True,
                "user_metadata": {"display_name": profile.get("display_name"), "tp_costing_role": profile.get("role")},
            },
        )
        auth_id = str(auth_user.get("id") or "")
        if not auth_id:
            raise RuntimeError("Auth user creation returned no immutable ID")
        api(
            "PATCH",
            f"/rest/v1/user_profiles?id=eq.{quote(str(profile['id']))}",
            service_key,
            {"auth_user_id": auth_id, "updated_at": datetime.now(timezone.utc).isoformat()},
            profile="tp_costing",
        )
        created.append((email, password, str(profile.get("role") or "viewer")))

    if created:
        with credentials_path.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(["email", "temporary_password", "role"])
            writer.writerows(created)
        os.chmod(credentials_path, 0o600)
        print(f"credentials_file={credentials_path}")
    print(f"created={len(created)}")
    print(f"already_linked={linked}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
