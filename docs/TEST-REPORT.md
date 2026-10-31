# ARAL Proxy — Test report

Environment used for verification: Linux sandbox (Python 3.12, Node 24), the real
pinned Telemt 3.5.14 engine binary, and a headless Chromium for UI checks.

## 1. Automated unit tests — all passing

| Suite | Scope | Result |
| --- | --- | --- |
| `scripts/test-panel.py` | Proxy manager (bootstrap, migration, CRUD, port/domain validation, limits), bridge bundle & rollback, engine config generation, usage accounting, resources, auth/CSRF/security headers, static assets, YouTube removal | **25/25 OK** |
| `scripts/test-network.py` | Public address verification, probe identity, origin allowlist, owner origin persistence, anonymous-request protection | **6/6 OK** |
| `scripts/test-port-router.py` | HTTP/MTProto multiplexing, fragmented requests, PROXY-protocol header, connection cap, ClientHello SNI parser (fragmented/malformed), SNI→engine routing, default fallback | **7/7 OK** |
| `scripts/test-bridge.mjs` | Cloudflare Worker bridge: origin allowlist, token binding, body size bounds, upstream failure handling | **0 failures** |

## 2. End-to-end tests with the real Telemt engine — all passing

`scripts/smoke_e2e.py` (32 checks): boot & health, authentication, one bootstrap
proxy running, TLS handshake answered by the engine, second proxy creation on a
chosen port, duplicate name/port/domain/privileged-port rejections, automatic
port allocation, disable/enable lifecycle (port closed while disabled), router
map contents, full persistence across a panel restart (names, secrets, links),
and deletion (registry + disk + router update).

`scripts/smoke_migration_sni.py` (16 checks): legacy `.data` migration
(secret/host/sponsor/bridge/usage preserved, link material identical, legacy
files untouched), SNI routing of two engines through one public port, HTTP
through the same port reaching the panel, per-proxy sponsor change without
touching other proxies.

## 3. QR encoder verification

- The bundled `panel/qr.js` encoder was rendered to bitmaps for 96 combinations
  (2 error-correction levels × 8 masks × 6 payloads incl. 122–200-char proxy links)
  and **all 96 decoded to the exact original text** with the independent
  `zxing-cpp` decoder. The automatic mask-selection path was verified separately (6/6).

## 4. Browser (UI) verification — headless Chromium

- Login renders with ARAL branding and dark artwork; sign-in reaches the dashboard.
- Overview: hero, status pills, aggregate traffic cards, resource meters, Telegram banner, footer links.
- Proxies page: default proxy card with live stats; second proxy created through
  the modal (name + port + domain); smart disabling of unavailable actions.
- Edit modal: General/Sponsored-channel/Cloudflare-bridge tabs pre-fill correctly
  from server state; per-proxy Worker download URLs.
- Dark ↔ Light toggle switches palette, logo, background and theme-color.
- English ↔ Persian toggle switches all texts and flips the layout to RTL;
  choice persists in localStorage across reloads.
- Guide page renders 8 sections + table of contents in the active language.
- Mobile (iPhone 14 viewport): no horizontal overflow, nav labels visible,
  cards and buttons stack correctly.
- Browser console: no errors; panel log: no Python errors.

## 5. Not verifiable in this environment (transparent limitations)

- **Public address publication** — the sandbox has no public IPv4, so the automatic
  public-endpoint discovery/verification and the resulting public links/QR contents
  could not be exercised end-to-end (the code path is covered by unit tests and the
  logic is unchanged from the previous, field-proven version).
- **Cloudflare WEB bridge in production** — the Worker relay logic is covered by
  `scripts/test-bridge.mjs` and the panel-side token routing by unit tests, but a
  real Cloudflare deployment was not available here.
- **Actual Telegram client connection** — connecting a real Telegram client through
  the proxy requires an internet-facing host; the engine's TLS handshake and FakeTLS
  configuration were verified at protocol level instead (engine answers, config
  matches the previous working schema).
- **Bot-Hosting platform specifics** — the platform-assigned `SERVER_PORT`
  behavior is read from environment variables exactly as before and is covered by
  the same tests; a live deployment should be smoke-checked after upload.
