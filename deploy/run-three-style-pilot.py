"""Run a clearly tagged three-style production pilot through the full workflow."""

from __future__ import annotations

import csv
import glob
import json
import os
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import HTTPCookieProcessor, Request, build_opener

BASE = "https://smart-tp-costing.5-223-78-194.sslip.io"
STYLES = ["M8836232", "M88118568", "M8836021"]
CHECKLIST = ["moq_checked", "lead_time_checked", "packaging_checked", "comparable_style_reviewed"]


class ApiError(RuntimeError):
    def __init__(self, status: int, path: str, data: object):
        super().__init__(f"HTTP {status} {path}: {str(data)[:400]}")
        self.status = status
        self.data = data


def api(opener, path: str, method: str = "GET", body: object | None = None):
    payload = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json", "Origin": BASE}
    try:
        response = opener.open(Request(BASE + path, method=method, data=payload, headers=headers), timeout=120)
        raw = response.read().decode("utf-8", errors="replace")
        return response.status, json.loads(raw) if raw else {}
    except HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            data = {"raw": raw[:400]}
        raise ApiError(error.code, path, data) from error


def login(user: dict[str, str]):
    opener = build_opener(HTTPCookieProcessor(CookieJar()))
    _, result = api(opener, "/api/auth/login", "POST", {"username": user["email"], "password": user["temporary_password"]})
    if result.get("role") != user["role"]:
        raise RuntimeError(f"Role mismatch for {user['role']}")
    return opener


def extract_lines(payload: object) -> list[dict]:
    if not isinstance(payload, dict):
        return []
    candidates: list[object] = [payload.get("data"), payload.get("items"), payload.get("results")]
    if isinstance(payload.get("data"), dict):
        nested = payload["data"]
        candidates.extend([nested.get("data"), nested.get("items"), nested.get("results"), nested.get("bomLines")])
    return next((item for item in candidates if isinstance(item, list)), [])


def text(item: dict, *keys: str, default: str = "Pilot material") -> str:
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return default


def number(item: dict, *keys: str, default: float = 1.0) -> float:
    for key in keys:
        try:
            value = float(item.get(key))
            if value >= 0:
                return value
        except (TypeError, ValueError):
            pass
    return default


def main():
    credential_files = sorted(glob.glob("/root/tp_costing_initial_credentials_*.csv"))
    with Path(credential_files[-1]).open(encoding="utf-8") as handle:
        users = list(csv.DictReader(handle))
    by_role = {user["role"]: user for user in users}
    pbd = login(by_role["pbd"])
    factory = login(by_role["factory"])
    costing = login(by_role["costing"])
    admin = login(by_role["admin"])

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    results: list[dict] = []

    for style_index, style in enumerate(STYLES):
        result = {"style": style, "run_id": run_id, "steps": []}
        _, bom_response = api(pbd, "/api/nextgen/bom/search?" + urlencode({"styleNumber": style}))
        bom = extract_lines(bom_response)
        if not bom:
            raise RuntimeError(f"{style} returned no BOM lines")
        result["bom_lines"] = len(bom)
        result["steps"].append("nextgen_bom_loaded")

        request_bom = []
        for item in bom:
            request_bom.append({
                "id": text(item, "id", "lineId", "nextgenLineId", default=f"{style}-{len(request_bom)+1}"),
                "category": text(item, "category", "materialType", "type", default="Material"),
                "materialName": text(item, "materialName", "material_name", "name", "description"),
                "usage": number(item, "usage", "consumption", "quantity"),
                "raw": item,
            })

        _, created = api(pbd, "/api/costing/requests", "POST", {
            "styleNumber": style,
            "productName": f"Automated pilot {style}",
            "factoryName": "PILOT QA FACTORY",
            "season": "PILOT-2026",
            "brand": "M88 PILOT",
            "customer": "INTERNAL QA",
            "productCategory": "Pilot Validation",
            "notes": f"AUTOMATED THREE-STYLE PILOT {run_id}; safe to archive after sign-off",
            "bomLines": request_bom,
            "nextgenRaw": bom_response,
            "forceCreate": True,
        })
        request_data = created.get("data") or {}
        request_id = request_data.get("id")
        if not request_id:
            raise RuntimeError(f"No request id returned for {style}: {created}")
        result["request_id"] = request_id
        result["request_number"] = request_data.get("request_number")
        result["steps"].append("request_created")

        api(pbd, f"/api/costing/requests/{request_id}/actions", "POST", {"action": "send_to_factory", "comment": f"Pilot {run_id}: send to factory"})
        result["steps"].append("sent_to_factory")

        cbd_lines = []
        for line_index, item in enumerate(request_bom):
            consumption = max(0.01, number(item, "usage", default=1.0))
            unit_cost = round(0.35 + style_index * 0.08 + line_index * 0.03, 2)
            cbd_lines.append({
                "materialName": item["materialName"],
                "unitCost": unit_cost,
                "consumption": consumption,
                "uom": "pc",
                "totalCost": round(unit_cost * consumption, 4),
                "currency": "USD",
            })
        api(factory, f"/api/costing/requests/{request_id}/cbd", "POST", {
            "status": "submitted", "currency": "USD", "customer": "INTERNAL QA", "season": "PILOT-2026",
            "styleNumber": style, "styleName": f"Pilot {style}", "costedQty": "1000 pcs", "protoVersion": "PILOT-1",
            "laborCost": 0.75, "overheadCost": 0.25, "profitMargin": 12, "moq": 1000, "leadTimeDays": 45,
            "materialBufferPercent": 3, "packagingCost": 0.18, "testingCost": 0.08,
            "brandNominatedItems": "Checked - internal pilot", "m88Packaging": "Standard M88 packaging",
            "yarnType": "Pilot yarn", "knitType": "Pilot knit", "machineType": "Pilot machine",
            "construction": "Pilot construction", "knittingTime": 10, "productCategory": "Pilot Validation",
            "costingLearning": "Automated pilot verifies full request workflow", "recurringIssueTags": "pilot,automation",
            "notes": f"AUTOMATED PILOT CBD {run_id}", "freightCost": 0.2, "dutyRate": 5,
            "insuranceCost": 0.02, "customsClearanceCost": 0.03, "inlandTransportCost": 0.04,
            "wholesaleMarkup": 2.2, "retailMarkup": 2.3, "lines": cbd_lines,
        })
        result["steps"].append("factory_cbd_submitted")

        api(costing, f"/api/costing/requests/{request_id}/checklist", "POST", {
            "items": [{"code": code, "isChecked": True, "comment": f"Verified by automated pilot {run_id}"} for code in CHECKLIST]
        })
        result["steps"].append("checklist_completed")
        api(costing, f"/api/costing/requests/{request_id}/actions", "POST", {"action": "costing_complete", "comment": f"Pilot {run_id}: costing validated"})
        result["steps"].append("costing_completed")
        api(admin, f"/api/costing/requests/{request_id}/actions", "POST", {"action": "approve", "comment": f"Pilot {run_id}: administrative approval"})
        result["steps"].append("approved")
        results.append(result)
        print(f"style={style} request={result.get('request_number') or request_id} bom={len(bom)} status=approved")

    output_dir = Path("/opt/smart-tp-costing/pilot-results")
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"three-style-pilot-{run_id}.json"
    output_path.write_text(json.dumps({"run_id": run_id, "result": "passed", "styles": results}, indent=2), encoding="utf-8")
    os.chmod(output_path, 0o600)
    print(f"pilot_result=passed evidence={output_path}")


if __name__ == "__main__":
    main()
