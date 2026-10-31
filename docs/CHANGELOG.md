# ARAL Proxy — Changelog

Upgrade from Blue Knight Proxy (single-proxy panel) to **ARAL Proxy** (multi-proxy panel).
The previous deployment's data is migrated automatically; no capability was removed.

## 1. Rebranding

- Complete rebrand to **ARAL Proxy**: page titles, header, login, footer, error paths,
  favicon and Worker names (`aral-proxy-tg-…`). No Blue Knight text or marks remain.
- New official artwork: dark & light logos and backgrounds (theme-aware), optimized
  for fast loading (4.1 MB source → 41–325 KB delivered assets).
- Telegram watermark replaced with **https://t.me/AralDev**
  ("Join Our Telegram Channel" / «پیوستن به کانال تلگرام ما») in the overview banner and footer.

## 2. Multi-proxy management (new backend capability)

- Each proxy is a **real, separate Telemt engine process** — not a UI card:
  - unique name, unique engine port, unique FakeTLS masking domain;
  - independent sponsor settings (ad tag / channel), independent WEB bridge, secret and links;
  - independent enable/disable, edit, delete with automatic rollback on failed restarts;
  - per-proxy live users, connections, traffic and uptime from each engine's own metrics.
- **Port safety**: reserved/occupied/privileged ports are rejected (bind-tested before use);
  automatic allocation scans from the configured base ports.
- **Capacity checks**: `PANEL_MAX_PROXIES` (default 8) plus memory/disk headroom guards.
- **Shared public port routing**: the public-port multiplexer now parses the TLS
  ClientHello SNI of each FakeTLS connection and dispatches it to the engine that owns
  that masking domain; unknown or absent SNI falls back to the default engine.
  The engine-to-domain map is published in `.data/router.json`.
- **Automatic migration**: the previous single-proxy state (secret, sponsor settings,
  bridge config + token, traffic totals, password) becomes the "Main proxy" entry.
  Old links stay valid; legacy files are preserved for a safe rollback.

## 3. Dark & light modes

- Manual **Dark/Light** toggle in the header; stored per browser (old `blueknight-theme`
  values are honored and mapped).
- The warm "cozy" third theme was replaced by a true light theme; every component
  (cards, inputs, badges, charts, notices, modals) has tuned palettes for both modes.
- Logo, background artwork and browser `theme-color` switch with the theme; transitions are short and GPU-cheap.

## 4. Persian / English (i18n + RTL)

- Full translations for every menu, label, message, error and guide section — no mixed-language leftovers.
- **RTL for Persian, LTR for English**, switching instantly without a page reload;
  mirrored inputs, steps, stats and badges.
- Self-hosted **Vazirmatn** Persian font (WOFF2, ~100 KB total) with system-font fallback.
- Server errors carry stable codes; the client renders localized messages for all of them.

## 5. Guide section (new)

- New «راهنما» / Guide page with 8 sections: introduction & features, login & first
  setup, creating & managing proxies, ports & connection settings, connection info &
  QR, services (sponsorship & bridge), troubleshooting, security & maintenance.
- Available in both languages and matching this version's real behavior.

## 6. Connection links & QR

- Per-proxy `tg://proxy` and `https://t.me/proxy` links (unchanged link format, unchanged compatibility).
- **QR code** modal with a bundled, dependency-free encoder (byte mode, versions 1–15,
  L/M error correction, automatic mask selection) — verified module-by-module against
  the zxing decoder.
- Copy buttons with clipboard fallback everywhere.

## 7. YouTube section removed

- The YouTube video card, `/api/latest-video*` endpoints, thumbnail proxy, feed/API
  client (`hosting/youtube.py`), related styles and its test were removed completely.
  No other feature depended on them.

## 8. UI/UX & performance

- Kept the existing visual identity and layout system; refined spacing, focus states and badges.
- Smooth, short animations only; `prefers-reduced-motion` fully respected.
- Responsive: mobile (375px), tablet and desktop verified; no horizontal scroll, no
  unreachable controls; the modal becomes a compact sheet, nav reflows to a grid.
- Performance: no new frameworks or runtime dependencies; the panel is pure stdlib
  Python + vanilla JS; statistics sampling keeps the previous cadence (5 s per engine,
  15 s UI polling); images/fonts are cached aggressively by the browser; single CSS/JS
  request each.

## 9. Security & robustness

- Same hardened authentication (PBKDF2, rate limiting, CSRF, HttpOnly/Secure cookies,
  strict CSP, 0600 private files) now covering all multi-proxy endpoints.
- Engine restarts validate readiness and roll back automatically on failure.
- Registry writes are atomic (`tmp` + rename); usage counters persist per proxy.

## 10. Internal quality

- Test suite updated and extended: panel/manager/bridge/usage/resources/auth (25),
  network discovery (6), port router incl. SNI parser and multi-routing (7), bridge
  worker (node), plus two end-to-end suites that run the real Telemt engine (48 checks).
- YouTube-related code paths deleted from tests as well.
