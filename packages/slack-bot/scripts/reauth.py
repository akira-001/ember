#!/usr/bin/env python3
"""Re-authenticate Google OAuth for Gmail/Calendar access.

Opens browser for consent, saves new credentials to ~/.gmail-mcp/credentials.json.
"""

import json
import http.server
import subprocess
import sys
import urllib.parse
from pathlib import Path
from urllib.request import Request, urlopen

OAUTH_PATH = Path.home() / ".gmail-mcp" / "gcp-oauth.keys.json"
CREDS_PATH = Path.home() / ".gmail-mcp" / "credentials.json"
SCOPES = "https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar"
REDIRECT_URI = "http://localhost:8085"


def main():
    oauth = json.loads(OAUTH_PATH.read_text())
    client = oauth.get("installed", oauth.get("web", {}))
    client_id = client["client_id"]
    client_secret = client["client_secret"]

    # Build authorization URL
    params = urllib.parse.urlencode({
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",
        "prompt": "consent",
    })
    auth_url = f"https://accounts.google.com/o/oauth2/auth?{params}"

    print(f"Opening Chrome for authentication...")
    print(f"URL: {auth_url}")
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", "Google Chrome", auth_url], check=False)
    else:
        subprocess.run(["google-chrome", auth_url], check=False)

    # Wait for redirect
    auth_code = None

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            nonlocal auth_code
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            auth_code = params.get("code", [None])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>Authentication successful! You can close this tab.</h1>")

        def log_message(self, format, *args):
            pass  # Suppress logs

    server = http.server.HTTPServer(("localhost", 8085), Handler)
    print("Waiting for authentication callback on localhost:8085...")
    server.handle_request()

    if not auth_code:
        print("ERROR: No authorization code received.")
        return

    # Exchange code for tokens
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "code": auth_code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI,
    }).encode()

    req = Request("https://oauth2.googleapis.com/token", data=data, method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")

    with urlopen(req, timeout=15) as resp:
        tokens = json.loads(resp.read())

    creds = {
        "access_token": tokens["access_token"],
        "refresh_token": tokens.get("refresh_token", ""),
        "scope": tokens.get("scope", SCOPES),
        "token_type": tokens.get("token_type", "Bearer"),
        "expiry_date": tokens.get("expires_in", 3600),
    }
    CREDS_PATH.write_text(json.dumps(creds, indent=2))
    print(f"Credentials saved to {CREDS_PATH}")
    print("Done!")


if __name__ == "__main__":
    main()
