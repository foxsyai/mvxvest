"""Fifth audit, WEB: what the two sites' nginx policy must keep, pinned.

Reads scripts/server/nginx-mvxvest.io.conf (the source of truth for the
droplet) and checks, for both server blocks that serve the app:

  - the CSP lets no script run but the site's own: script-src 'self' only,
    no 'unsafe-inline', 'unsafe-eval', data:, blob:, http: or a wildcard
    anywhere but the one 'unsafe-inline' in style-src;
  - connect-src names only the MultiversX API, gateway, tools and socket
    hosts of its own network and the WalletConnect relays, so an injected
    script could not carry data anywhere else;
  - frame-ancestors 'none', X-Frame-Options DENY, base-uri 'self',
    object-src 'none', upgrade-insecure-requests, HSTS, nosniff, COOP,
    a Referrer-Policy and a Permissions-Policy; every header with `always`;
  - no add_header inside a location (it would drop the server's headers);
  - no autoindex, no source map or dotfile served on purpose, the document
    revalidated every time (expires -1 on /index.html);
  - the HTTP vhosts redirect to the HTTPS host of the same name.

With MVXVEST_LIVE=1 it also fetches both sites and checks the headers served
equal, name by name, the add_header lines of the file (ordinary GET requests,
three per site). These all pass on 26b0d4c on 1 Nov 2026: a record of what was
attacked and held, not a finding.

    python3 scripts/ci/audit5_web_nginx_test.py
    MVXVEST_LIVE=1 python3 scripts/ci/audit5_web_nginx_test.py
"""

import os
import re
import unittest
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONF = (ROOT / "scripts/server/nginx-mvxvest.io.conf").read_text()

HOSTS = {
    "mvxvest.io": {
        "api": "https://api.multiversx.com",
        "gateway": "https://gateway.multiversx.com",
        "socket": "socket-api-ovh.multiversx.com",
        "wallet": "https://wallet.multiversx.com",
    },
    "devnet.mvxvest.io": {
        "api": "https://devnet-api.multiversx.com",
        "gateway": "https://devnet-gateway.multiversx.com",
        "socket": "devnet-socket-api.multiversx.com",
        "wallet": "https://devnet-wallet.multiversx.com",
    },
}


def blocks():
    """The server blocks, as (server_name, text)."""
    out = []
    for text in re.split(r"^server \{$", CONF, flags=re.M)[1:]:
        name = re.search(r"server_name ([^;]+);", text).group(1).strip()
        out.append((name, text))
    return out


def app_block(host):
    for name, text in blocks():
        if name == host and re.search(r"^\s*root /var/www/", text, re.M):
            return text
    raise AssertionError(f"no app block for {host}")


def headers_of(text):
    """add_header lines as {name: (value, always)}."""
    out = {}
    for m in re.finditer(r'^\s*add_header\s+(\S+)\s+"([^"]*)"(\s+always)?;', text, re.M):
        out[m.group(1)] = (m.group(2), bool(m.group(3)))
    return out


def csp_of(text):
    value = headers_of(text)["Content-Security-Policy"][0]
    out = {}
    for directive in value.split(";"):
        parts = directive.split()
        if parts:
            out[parts[0]] = parts[1:]
    return out


class Policy(unittest.TestCase):
    def test_two_app_hosts(self):
        names = [n for n, t in blocks() if re.search(r"^\s*root /var/www/", t, re.M)]
        self.assertEqual(names, ["mvxvest.io", "devnet.mvxvest.io"])

    def test_headers_always_and_present(self):
        for host in HOSTS:
            with self.subTest(host=host):
                h = headers_of(app_block(host))
                for name in (
                    "Strict-Transport-Security",
                    "X-Content-Type-Options",
                    "X-Frame-Options",
                    "Referrer-Policy",
                    "Permissions-Policy",
                    "Cross-Origin-Opener-Policy",
                    "Content-Security-Policy",
                ):
                    self.assertIn(name, h)
                    self.assertTrue(h[name][1], f"{name} without always")
                self.assertEqual(h["X-Frame-Options"][0], "DENY")
                self.assertEqual(h["X-Content-Type-Options"][0], "nosniff")
                self.assertRegex(h["Strict-Transport-Security"][0], r"max-age=\d{7,}; includeSubDomains")
                self.assertEqual(h["Cross-Origin-Opener-Policy"][0], "same-origin-allow-popups")

    def test_csp_scripts_only_self(self):
        for host in HOSTS:
            with self.subTest(host=host):
                csp = csp_of(app_block(host))
                self.assertEqual(csp["script-src"], ["'self'"])
                self.assertEqual(csp["default-src"], ["'self'"])
                self.assertEqual(csp["base-uri"], ["'self'"])
                self.assertEqual(csp["object-src"], ["'none'"])
                self.assertEqual(csp["frame-ancestors"], ["'none'"])
                self.assertIn("upgrade-insecure-requests", csp)
                for directive, sources in csp.items():
                    for s in sources:
                        self.assertNotIn("*", s, f"{directive} has a wildcard")
                        self.assertFalse(s.startswith("http:"), f"{directive} allows http:")
                        self.assertNotIn("unsafe-eval", s)
                        self.assertNotIn("unsafe-hashes", s)
                        self.assertNotIn("blob:", s)
                        if directive != "style-src":
                            self.assertNotIn("unsafe-inline", s, f"{directive} allows inline")
                        if directive != "img-src":
                            self.assertNotEqual(s, "data:", f"{directive} allows data:")
                # No script-src-elem/attr, worker-src or child-src that would widen script-src.
                for widened in ("script-src-elem", "script-src-attr", "worker-src", "child-src"):
                    self.assertNotIn(widened, csp)

    def test_connect_src_is_own_network_only(self):
        for host, net in HOSTS.items():
            with self.subTest(host=host):
                csp = csp_of(app_block(host))
                self.assertEqual(
                    sorted(csp["connect-src"]),
                    sorted(
                        [
                            "'self'",
                            net["api"],
                            net["gateway"],
                            "https://tools.multiversx.com",
                            "wss://relay.walletconnect.com",
                            "wss://relay.walletconnect.org",
                            "https://" + net["socket"],
                            "wss://" + net["socket"],
                        ]
                    ),
                )
                self.assertEqual(csp["form-action"], ["'self'", net["wallet"]])
                self.assertEqual(
                    csp["frame-src"],
                    ["https://verify.walletconnect.com", "https://verify.walletconnect.org"],
                )
                # Nothing of the other network: a devnet CSP must not reach mainnet hosts and the reverse.
                other = [n for n in HOSTS if n != host][0]
                for s in csp["connect-src"]:
                    self.assertNotIn(HOSTS[other]["api"], s)

    def test_no_add_header_in_a_location(self):
        for host in HOSTS:
            with self.subTest(host=host):
                text = app_block(host)
                for m in re.finditer(r"location[^{]*\{([^}]*)\}", text):
                    self.assertNotIn("add_header", m.group(1), "a location's add_header drops the server's headers")

    def test_no_listing_no_maps_document_revalidated(self):
        self.assertNotRegex(CONF, r"autoindex\s+on")
        self.assertNotIn(".map", CONF)
        for host in HOSTS:
            with self.subTest(host=host):
                text = app_block(host)
                self.assertRegex(text, r"location = /index\.html \{ expires -1; \}")
                self.assertRegex(text, r"try_files \$uri \$uri/ /index\.html;")

    def test_http_redirects_to_same_host(self):
        for name, text in blocks():
            if "listen 80;" in text:
                host = name.split()[0]
                self.assertRegex(text, r"return 301 https://" + re.escape(host) + r"\$request_uri;")
                self.assertIn("/.well-known/acme-challenge/", text)


@unittest.skipUnless(os.environ.get("MVXVEST_LIVE") == "1", "set MVXVEST_LIVE=1 to compare with the live sites")
class Live(unittest.TestCase):
    def fetch(self, url):
        req = urllib.request.Request(url, headers={"User-Agent": "mvxvest-audit5-web"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, {k.lower(): v for k, v in r.getheaders()}, r.read()

    def test_live_headers_equal_the_file(self):
        for host in HOSTS:
            with self.subTest(host=host):
                expected = headers_of(app_block(host))
                for path in ("/", "/v/1", "/assets/"):
                    try:
                        status, live, _ = self.fetch(f"https://{host}{path}")
                    except urllib.error.HTTPError as e:  # /assets/ is a 403, still with every header
                        status, live = e.code, {k.lower(): v for k, v in e.headers.items()}
                    for name, (value, _always) in expected.items():
                        self.assertEqual(live.get(name.lower()), value, f"{host}{path} {name} ({status})")
                    self.assertEqual(live.get("server"), "nginx", "the server version must stay hidden")

    def test_live_document_not_cached_and_version_is_main(self):
        for host in HOSTS:
            with self.subTest(host=host):
                _, h, _ = self.fetch(f"https://{host}/")
                self.assertEqual(h.get("cache-control"), "no-cache")
                _, _, body = self.fetch(f"https://{host}/version.txt")
                self.assertRegex(body.decode(), r"^[0-9a-f]{40} (mainnet|devnet)\n?$")


if __name__ == "__main__":
    unittest.main(verbosity=2)
