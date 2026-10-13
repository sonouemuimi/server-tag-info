#!/usr/bin/env python3
"""Local-only static hosting of built plugin files; no account data or uploads."""
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path

root = Path(__file__).resolve().parent / 'dist'
handler = partial(SimpleHTTPRequestHandler, directory=str(root))
print('Revenge plugin URL: http://127.0.0.1:8765/emoji-exporter/', flush=True)
print('Only build files are served; Ctrl+C to stop.', flush=True)
with ThreadingHTTPServer(('127.0.0.1', 8765), handler) as server:
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
