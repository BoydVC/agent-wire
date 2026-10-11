#!/usr/bin/env python3
"""Agent Wire collector — read-only scan of agent profiles (+ optional fleet.json).

Writes data/wire.json only. Never writes back into /home/box/agent-data.
No prompts, transcripts, memory contents, or secrets are exported.
"""
from __future__ import annotations

import json
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
AGENTS_ROOT = "/home/box/agent-data/agents"
FLEET_PATH = "/workspace/tokenmax/bot-island/data/fleet.json"
OUT = os.path.join(HERE, "data", "wire.json")

# Cap events kept in the wire snapshot (UI samples from these).
EVENT_CAP = 2500


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return default


def slug_to_title(slug: str) -> str:
    return re.sub(r"[-_]+", " ", slug).strip().title() or "unknown"


def scan_routines(agent_dir: str) -> list[dict]:
    """Read automation folder metadata only (name/schedule/enabled/lastRunAt). Never prompts."""
    auto = os.path.join(agent_dir, "automations")
    if not os.path.isdir(auto):
        return []
    out = []
    for slug in sorted(os.listdir(auto)):
        folder = os.path.join(auto, slug)
        if not os.path.isdir(folder):
            continue
        meta = read_json(os.path.join(folder, "automation.json"), {}) or {}
        name = meta.get("name") if isinstance(meta.get("name"), str) and meta.get("name").strip() else None
        schedule = meta.get("schedule") if isinstance(meta.get("schedule"), str) else None
        enabled = meta.get("enabled") if isinstance(meta.get("enabled"), bool) else None
        last_run = meta.get("lastRunAt")
        out.append(
            {
                "slug": slug,
                "name": name or slug_to_title(slug),
                "schedule": schedule if schedule else "unknown",
                "enabled": enabled if enabled is not None else "unknown",
                "lastRunAt": last_run if last_run is not None else "unknown",
            }
        )
    return out


def scan_profiles() -> list[dict]:
    bots = []
    if not os.path.isdir(AGENTS_ROOT):
        return bots
    for entry in sorted(os.listdir(AGENTS_ROOT)):
        agent_dir = os.path.join(AGENTS_ROOT, entry)
        if not os.path.isdir(agent_dir):
            continue
        profile_path = os.path.join(agent_dir, "profile.json")
        if not os.path.isfile(profile_path):
            continue
        p = read_json(profile_path, {}) or {}
        name = p.get("name") if isinstance(p.get("name"), str) and p.get("name").strip() else None
        if not name:
            continue  # require a real name; never invent
        title = p.get("title")
        if not isinstance(title, str) or not title.strip():
            title = "unknown"
        color = p.get("avatarColor") if isinstance(p.get("avatarColor"), str) else "unknown"
        shape = p.get("avatarShape") if isinstance(p.get("avatarShape"), str) else "unknown"
        harness = p.get("harness") if isinstance(p.get("harness"), str) else "unknown"
        named_by = p.get("namedBy") if isinstance(p.get("namedBy"), str) else "unknown"
        # Fleet events key bots by the agent folder UUID, not profile.serverId
        server_id = p.get("serverId") if isinstance(p.get("serverId"), str) else "unknown"
        desc = p.get("description")
        # Short blurb only; no full system prompt dump
        blurb = "unknown"
        if isinstance(desc, str) and desc.strip():
            first = desc.strip().split("\n")[0].strip()
            blurb = (first[:180] + "…") if len(first) > 180 else first
        routines = scan_routines(agent_dir)
        bots.append(
            {
                "id": entry,
                "folderId": entry,
                "serverId": server_id,
                "name": name,
                "title": title,
                "avatarColor": color,
                "avatarShape": shape,
                "harness": harness,
                "namedBy": named_by,
                "blurb": blurb,
                "routines": routines,
                "routineCount": len(routines),
            }
        )
    return bots


def merge_fleet(bots: list[dict]) -> tuple[list[dict], list[dict], list[str], dict]:
    """Optionally enrich from bot-island fleet.json. Returns events, eventDays, fleet meta."""
    fleet = read_json(FLEET_PATH)
    meta = {
        "fleetPath": FLEET_PATH,
        "fleetPresent": bool(fleet),
        "fleetGeneratedAt": (fleet or {}).get("generatedAt", "unknown") if fleet else "unknown",
    }
    if not fleet:
        return [], [], meta

    by_id = {b["id"]: b for b in bots}
    # also map folderId
    by_folder = {b["folderId"]: b for b in bots}

    for fb in fleet.get("bots") or []:
        bid = fb.get("id")
        target = by_id.get(bid) or by_folder.get(bid)
        if not target:
            continue
        if fb.get("eventCount") is not None:
            target["eventCount"] = fb.get("eventCount")
        if fb.get("chatCount") is not None:
            target["chatCount"] = fb.get("chatCount")
        if fb.get("building"):
            target["building"] = fb.get("building")
        # Prefer live automation scan; if empty and fleet has routine names, copy names only
        if not target["routines"] and fb.get("routines"):
            for r in fb["routines"]:
                if not isinstance(r, dict):
                    continue
                rname = r.get("name")
                if not isinstance(rname, str) or not rname.strip():
                    continue
                target["routines"].append(
                    {
                        "slug": "unknown",
                        "name": rname,
                        "schedule": r.get("cron") if isinstance(r.get("cron"), str) else "unknown",
                        "enabled": r.get("enabled") if isinstance(r.get("enabled"), bool) else "unknown",
                        "lastRunAt": r.get("lastRunAt") if r.get("lastRunAt") is not None else "unknown",
                        "source": "fleet.json",
                    }
                )
            target["routineCount"] = len(target["routines"])

    events_raw = fleet.get("events") or []
    # Keep latest EVENT_CAP by timestamp
    events_sorted = sorted(
        [e for e in events_raw if isinstance(e, dict) and e.get("ts")],
        key=lambda e: e.get("ts") or "",
    )
    if len(events_sorted) > EVENT_CAP:
        events_sorted = events_sorted[-EVENT_CAP:]

    # Sanitize: only known safe fields
    events = []
    for e in events_sorted:
        item = {
            "ts": e.get("ts"),
            "type": e.get("type") or "unknown",
            "bot": e.get("bot") or "unknown",
        }
        if e.get("app"):
            item["app"] = e["app"]
        if e.get("tool"):
            item["tool"] = str(e["tool"])[:48]
        if e.get("from"):
            item["from"] = e["from"]
        if e.get("host"):
            item["host"] = str(e["host"])[:60]
        if e.get("ms") is not None:
            item["ms"] = e["ms"]
        events.append(item)

    days = fleet.get("eventDaysUTC") or []
    if not isinstance(days, list):
        days = []
    days = [d for d in days if isinstance(d, str)]

    return events, days, meta


def build_edges(bots: list[dict], events: list[dict]) -> list[dict]:
    """Edges from agent_msg co-occurrence; else soft same-household heuristic."""
    id_set = {b["id"] for b in bots}
    pair = Counter()
    for e in events:
        if e.get("type") != "agent_msg":
            continue
        a, b = e.get("from"), e.get("bot")
        if not a or not b or a == "unknown" or b == "unknown":
            continue
        if a not in id_set or b not in id_set:
            continue
        key = tuple(sorted((a, b)))
        pair[key] += 1

    edges = []
    if pair:
        for (a, b), w in pair.most_common(80):
            edges.append({"source": a, "target": b, "weight": w, "kind": "cooccurrence"})
        return edges

    # Heuristic: soft link every bot to Michael (CoS) if present, labeled heuristic
    michael = next((b for b in bots if b["name"] == "Michael"), None)
    if michael:
        for b in bots:
            if b["id"] == michael["id"]:
                continue
            edges.append(
                {
                    "source": michael["id"],
                    "target": b["id"],
                    "weight": 1,
                    "kind": "heuristic",
                    "label": "same household (heuristic)",
                }
            )
    else:
        # ring of soft links
        for i, b in enumerate(bots):
            nxt = bots[(i + 1) % len(bots)] if bots else None
            if nxt and b["id"] != nxt["id"]:
                edges.append(
                    {
                        "source": b["id"],
                        "target": nxt["id"],
                        "weight": 1,
                        "kind": "heuristic",
                        "label": "same household (heuristic)",
                    }
                )
    return edges


def main():
    collected_at = utc_now()
    bots = scan_profiles()
    events, event_days, fleet_meta = merge_fleet(bots)
    edges = build_edges(bots, events)

    # Wire-rain chip stream: derive a compact chip list from events (or synthetic placeholders from bots)
    chips = []
    type_label = {
        "mcp_tool_call": "tool",
        "shell_command": "shell",
        "browser_navigation": "browser",
        "agent_msg": "message",
        "boyd_msg": "message",
        "computer_use_session": "computer",
        "file_write": "file",
        "dated_output": "output",
        "routine_touch": "routine",
    }
    name_by_id = {b["id"]: b["name"] for b in bots}
    for e in events[-800:]:
        bot_name = name_by_id.get(e.get("bot"), "unknown")
        kind = type_label.get(e.get("type"), e.get("type") or "unknown")
        detail = e.get("tool") or e.get("app") or e.get("host") or kind
        chips.append(
            {
                "ts": e.get("ts"),
                "kind": kind,
                "type": e.get("type"),
                "bot": bot_name,
                "botId": e.get("bot"),
                "detail": detail,
            }
        )

    # If no events, still show routine-fire chips from real routine names (not invented bots)
    if not chips:
        for b in bots:
            for r in b.get("routines") or []:
                chips.append(
                    {
                        "ts": "unknown",
                        "kind": "routine",
                        "type": "routine_touch",
                        "bot": b["name"],
                        "botId": b["id"],
                        "detail": r.get("name") or "unknown",
                    }
                )

    routine_total = sum(b.get("routineCount") or 0 for b in bots)
    type_counts = Counter(e.get("type") or "unknown" for e in events)

    wire = {
        "generatedAt": collected_at,
        "timezone": "America/New_York",
        "sources": {
            "profiles": AGENTS_ROOT,
            "fleet": fleet_meta,
        },
        "stats": {
            "botCount": len(bots),
            "routineCount": routine_total,
            "eventCount": len(events),
            "eventDayCount": len(event_days),
            "chipCount": len(chips),
            "edgeCount": len(edges),
            "edgeKind": edges[0]["kind"] if edges else "none",
            "lastCollectorAt": collected_at,
            "typeCounts": dict(type_counts),
        },
        "bots": bots,
        "events": events,
        "eventDaysUTC": event_days,
        "chips": chips,
        "edges": edges,
    }

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(wire, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(
        f"wrote {OUT} · bots={len(bots)} routines={routine_total} "
        f"events={len(events)} chips={len(chips)} edges={len(edges)} "
        f"fleet={'yes' if fleet_meta.get('fleetPresent') else 'no'}"
    )


if __name__ == "__main__":
    main()
