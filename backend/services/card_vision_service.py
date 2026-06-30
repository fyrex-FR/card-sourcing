from __future__ import annotations

import base64
import json
import os
import time
from typing import Any
from urllib.parse import quote_plus, urlencode

import httpx


_GEMINI_MODEL = os.getenv("CARD_VISION_MODEL", "gemini-2.5-flash")
_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models"
_CACHE: dict[str, dict[str, Any]] = {}


SYSTEM_PROMPT = """## TASK
You are a world-class sports trading card expert. Analyze one FRONT image of a sports card plus marketplace metadata, then return a precise JSON object for resale comp search.

## CONTEXT
Only the front image is available. Marketplace metadata may include player, team, card number, serial number, grade, and a weak title. Use the image to recover missing manufacturer, set, insert, parallel, year, rookie, autograph, patch, and visible numbering.

## RULES
- Do not hallucinate. If text is not readable and the visual signal is weak, use an empty string and low confidence.
- Prefer visible text on the card over marketplace metadata.
- Use marketplace metadata only as a hint, especially for player/team/card number/serial.
- Never output placeholders such as "unknown", "N/A", or "***". Use empty strings.
- Return only valid JSON. No markdown.

## FIELD DEFINITIONS
- player: full player name.
- team: full team name.
- year: card edition season, e.g. "2023-24".
- manufacturer: Panini, Topps, Upper Deck, Leaf, Skybox, Fleer, etc.
- set_name: main product line only, e.g. "Prizm", "Donruss Optic", "Mosaic", "Select", "Noir", "Immaculate Collection", "National Treasures".
- insert_name: printed subset/tier/design name, e.g. "Concourse", "Premier Level", "Courtside", "Splash Zone", "Rated Rookie", "Rookie Signatures". Empty if base.
- parallel_name: physical finish/color variant, e.g. "Silver Prizm", "Gold Prizm", "Blue", "Holo", "Zebra", "Tie-Dye", "Mojo Prizm". Use "Base" only if you have visual confidence it is base.
- parallel_confidence: integer 0-100.
- card_number: printed card number with # prefix when known, e.g. "#3".
- numbered: print run only, e.g. "/10", "/49". Do not include the card's serial position.
- serial: exact stamped serial if visible or provided, e.g. "9/10".
- is_rookie: true for explicit RC/Rated Rookie/Rookie text or strong rookie-year evidence.
- is_autograph: true if a real/sticker/on-card autograph is visible.
- is_patch: true if a jersey/patch/relic window is visible.
- card_type: one of "auto_patch", "auto", "patch", "numbered", "parallel", "insert", "base".
- search_query: compact eBay sold search query built from reliable fields only. Include year/manufacturer/set/player/team/card_number/parallel/numbered when confident. Do not include the exact serial position unless it is useful and not too restrictive.
- confidence: integer 0-100 for the overall extraction.

## VISUAL GUIDE
- Prizm Silver has clear rainbow/wavy prizm lines; Mojo has concentric rings; Disco has scattered sparkle dots; Hyper has dense diagonal crisscross.
- Donruss Optic uses "Holo" rather than "Silver Prizm".
- Select tiers are Concourse, Premier Level, Courtside; these are insert/tier names, not parallels.
- Chronicles is the main set; large design labels like Luminance, Prestige, Flux are insert/subset names.
- Premium sets such as Noir, National Treasures, Flawless, Immaculate often have autos, patches, and low print runs.

## OUTPUT FORMAT
{"player":"","team":"","year":"","manufacturer":"","set_name":"","insert_name":"","parallel_name":"","parallel_confidence":0,"card_number":"","numbered":"","serial":"","is_rookie":false,"is_autograph":false,"is_patch":false,"card_type":"base","search_query":"","confidence":0}
"""


def _clean_text(value: Any) -> str:
    if value is None:
        return ""
    text = str(value).strip()
    return "" if text.lower() in {"unknown", "n/a", "none", "null", "***"} else text


def _normalize_result(raw: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    out = {
        "player": _clean_text(raw.get("player")) or _clean_text(metadata.get("player")),
        "team": _clean_text(raw.get("team")) or _clean_text(metadata.get("team")),
        "year": _clean_text(raw.get("year")) or _clean_text(metadata.get("year")),
        "manufacturer": _clean_text(raw.get("manufacturer")) or _clean_text(metadata.get("manufacturer")),
        "set_name": _clean_text(raw.get("set_name")) or _clean_text(metadata.get("set_name")),
        "insert_name": _clean_text(raw.get("insert_name")),
        "parallel_name": _clean_text(raw.get("parallel_name")),
        "parallel_confidence": int(raw.get("parallel_confidence") or 0),
        "card_number": _clean_text(raw.get("card_number")) or _clean_text(metadata.get("card_number")),
        "numbered": _clean_text(raw.get("numbered")) or (
            f"/{metadata.get('sequence_number')}" if _clean_text(metadata.get("sequence_number")) not in {"", "0"} else ""
        ),
        "serial": _clean_text(raw.get("serial")) or (
            f"{metadata.get('serial_number')}/{metadata.get('sequence_number')}"
            if _clean_text(metadata.get("serial_number")) not in {"", "0"} and _clean_text(metadata.get("sequence_number")) not in {"", "0"}
            else ""
        ),
        "is_rookie": bool(raw.get("is_rookie")),
        "is_autograph": bool(raw.get("is_autograph")),
        "is_patch": bool(raw.get("is_patch")),
        "card_type": _clean_text(raw.get("card_type")) or "base",
        "confidence": int(raw.get("confidence") or 0),
    }
    out["search_query"] = _clean_text(raw.get("search_query")) or build_search_query(out)
    return out


def build_search_query(fields: dict[str, Any]) -> str:
    parts = [
        fields.get("year"),
        fields.get("manufacturer"),
        fields.get("set_name"),
        fields.get("insert_name"),
        fields.get("player"),
        fields.get("team"),
        fields.get("card_number"),
    ]
    parallel = _clean_text(fields.get("parallel_name"))
    if parallel and parallel.lower() != "base" and int(fields.get("parallel_confidence") or 0) >= 65:
        parts.append(parallel)
    if fields.get("numbered"):
        parts.append(fields.get("numbered"))
    if fields.get("is_autograph"):
        parts.append("auto")
    if fields.get("is_rookie"):
        parts.append("rookie")
    return " ".join(_clean_text(part) for part in parts if _clean_text(part))


def comp_urls(query: str) -> dict[str, str]:
    ebay_params = urlencode({"_nkw": query, "LH_Sold": "1", "LH_Complete": "1", "_sop": "13"})
    return {
        "ebay_sold_url": f"https://www.ebay.com/sch/i.html?{ebay_params}",
        "one30point_url": f"https://130point.com/sales/?search={quote_plus(query)}",
    }


async def enrich_card_from_image(*, image_url: str, metadata: dict[str, Any]) -> dict[str, Any]:
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY", "")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY or GEMINI_API_KEY not configured")
    if not image_url:
        raise RuntimeError("image_url is required")

    cache_key = f"{image_url}|{json.dumps(metadata, sort_keys=True)}"
    if cache_key in _CACHE:
        return _CACHE[cache_key]

    async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
        image_resp = await client.get(image_url)
        image_resp.raise_for_status()
        image_b64 = base64.b64encode(image_resp.content).decode("ascii")
        mime_type = image_resp.headers.get("content-type", "image/jpeg").split(";")[0] or "image/jpeg"

        payload = {
            "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [
                        {"inline_data": {"mime_type": mime_type, "data": image_b64}},
                        {"text": f"Marketplace metadata hint:\n{json.dumps(metadata, ensure_ascii=False)}\nReturn the JSON."},
                    ],
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "maxOutputTokens": 2048,
            },
        }

        t0 = time.monotonic()
        resp = await client.post(f"{_API_BASE}/{_GEMINI_MODEL}:generateContent?key={api_key}", json=payload)
    latency_ms = int((time.monotonic() - t0) * 1000)
    if resp.status_code != 200:
        raise RuntimeError(f"Gemini API {resp.status_code}: {resp.text[:500]}")

    data = resp.json()
    raw = data["candidates"][0]["content"]["parts"][0]["text"].strip()
    if raw.startswith("```"):
        raw = raw.split("```")[1]
        if raw.startswith("json"):
            raw = raw[4:]
        raw = raw.strip()
    result = _normalize_result(json.loads(raw), metadata)
    result["search_query"] = build_search_query(result)
    result.update(comp_urls(result["search_query"]))
    result["latency_ms"] = latency_ms
    _CACHE[cache_key] = result
    return result
