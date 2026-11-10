#!/usr/bin/env python3
"""Refresh the install manifest after editing index.js; no dependencies."""
import hashlib
import json
from pathlib import Path

base = Path(__file__).resolve().parent
manifest = {
    "name": "Hide Blocked Messages · 无占位修复",
    "description": "过滤屏蔽/忽略消息与占位提示，可保留别人回复并去掉引用。test1：手机实测待确认；请关闭旧隐藏插件。",
    "authors": [{"name": "Sonoue Muimi"}],
    "version": "1.0.0-test1",
    "main": "index.js",
    "hash": hashlib.sha256((base / "index.js").read_bytes()).hexdigest(),
    "vendetta": {"icon": "ic_badge_staff"},
}
(base / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("manifest.json updated")
