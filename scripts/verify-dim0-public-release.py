#!/usr/bin/env python3
"""Read-only verification of the published Dim0 UI and single-use redirect.

Example:
  python3 scripts/verify-dim0-public-release.py \
    https://barbie-discovery-bingo-system.trycloudflare.com
"""
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, build_opener, urlopen
import sys

class ModuleEntries(HTMLParser):
    def __init__(self):
        super().__init__()
        self.entries = []

    def handle_starttag(self, tag, attrs):
        fields = dict(attrs)
        if tag == "script" and fields.get("type") == "module" and fields.get("src"):
            self.entries.append(fields["src"])

def entry(html: str) -> str:
    parser = ModuleEntries()
    parser.feed(html)
    if len(parser.entries) != 1:
        raise RuntimeError(f"Expected one Vite module entry, got {parser.entries!r}")
    return parser.entries[0]

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None

def verify(origin: str, dist: Path) -> None:
    origin = origin.rstrip("/")
    parsed = urlsplit(origin)
    if parsed.scheme != "https" and not (
        parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"}
    ):
        raise RuntimeError("Only HTTPS or localhost QA origins are supported")
    local_entry = entry((dist / "index.html").read_text())
    with urlopen(origin + "/signin", timeout=15) as response:
        live_entry = entry(response.read().decode())
    print(f"CANDIDATE_ENTRY {local_entry}")
    print(f"PUBLIC_ENTRY {live_entry}")
    if local_entry != live_entry:
        raise RuntimeError("Frontend entry mismatch; do not claim this candidate is public")
    local_bytes = (dist / urlsplit(local_entry).path.lstrip("/")).read_bytes()
    with urlopen(urljoin(origin + "/", live_entry), timeout=15) as response:
        live_bytes = response.read()
    if sha256(local_bytes).digest() != sha256(live_bytes).digest():
        raise RuntimeError("Frontend entry bytes differ despite matching filenames")
    print(f"PUBLIC_ENTRY_SHA256 {sha256(local_bytes).hexdigest()}")

    board = "12345678-1234-4567-89ab-123456789abc"
    token = "A" * 43  # Not a real invitation; cannot grant access
    probe = origin + f"/patchboard-private/?board={board}&invite={token}"
    try:
        with build_opener(NoRedirect()).open(probe, timeout=15) as response:
            raise RuntimeError(f"Expected 302, got {response.status}")
    except HTTPError as response:
        expected = f"/share/join/{board}#invite={token}"
        if response.code != 302 or response.headers.get("Location") != expected:
            raise RuntimeError(
                f"Public single-use redirect mismatch (HTTP {response.code}); "
                "switch both frontend and server to the tested pair"
            ) from None
    print("PUBLIC_FRONTEND_AND_INVITE_ROUTING_MATCH", local_entry)

if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        raise SystemExit("Usage: verify-dim0-public-release.py ORIGIN [DIST]")
    try:
        verify(sys.argv[1], Path(sys.argv[2] if len(sys.argv) == 3 else "webui/dist"))
    except (OSError, RuntimeError, ValueError) as exc:
        raise SystemExit(f"RELEASE_CHECK_FAILED: {exc}")
