#!/usr/bin/env python3
from __future__ import annotations

import json
import shlex
import subprocess
import sys
from pathlib import Path
from typing import Any, List


SCRIPT_DIR = Path(__file__).resolve().parent
CORE = SCRIPT_DIR / "hermes_lp_agent.py"


def quote_arg(value: Any) -> str:
    return str(value)


def read_raw_input() -> str:
    if len(sys.argv) > 1:
        return " ".join(sys.argv[1:]).strip()
    try:
        return sys.stdin.read().strip()
    except OSError:
        return ""


def normalize_json_input(raw: str) -> List[str]:
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("Strict JSON input must be an object.")
    if isinstance(parsed.get("argv"), list):
        return [quote_arg(value) for value in parsed["argv"]]
    command = str(parsed.get("command") or "").strip()
    if not command:
        raise ValueError("Strict JSON input requires command or argv.")
    args = parsed.get("args") or []
    if not isinstance(args, list):
        raise ValueError("Strict JSON args must be a list.")
    return [command, *[quote_arg(value) for value in args]]


def normalize_input(raw: str) -> List[str]:
    text = raw.strip()
    if not text:
        raise ValueError("Usage: hermes_agent.py '<command args>' or JSON input.")
    if text.startswith("{"):
        return normalize_json_input(text)
    return shlex.split(text)


def main() -> int:
    try:
        argv = normalize_input(read_raw_input())
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2

    if argv and argv[0] in {"plan", "heartbeat"} and "--output-mode" not in argv and "--json" not in argv:
        argv = [*argv, "--output-mode", "raw"]
    if argv and argv[0] in {"health", "contracts"} and "--json" not in argv:
        argv = [*argv, "--json"]

    proc = subprocess.run(
        [sys.executable, str(CORE), *argv],
        text=True,
        capture_output=True,
        timeout=180,
    )
    if proc.returncode != 0:
        sys.stderr.write(proc.stderr or proc.stdout or f"hermes_agent failed: {proc.returncode}\n")
        return proc.returncode or 1
    sys.stdout.write(proc.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
