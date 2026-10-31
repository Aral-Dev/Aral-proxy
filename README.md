# ARAL Proxy — Bot-Hosting

A Telegram MTProto (FakeTLS) proxy panel with **multiple independent proxy instances**, per-proxy sponsored-channel settings, a Cloudflare WEB bridge, live usage statistics, a full Persian/English interface with dark & light themes, and an optional Cloudflare Worker bridge. Built for easy deployment on Bot-Hosting, with automatic network configuration and a password you choose during setup.

- **Telegram channel:** [t.me/AralDev](https://t.me/AralDev)

## Highlights

- **Multi-proxy engine management** — create, edit, enable/disable and delete real Telemt engine instances, each with its own name, port, masking domain, links and statistics. Port and domain conflicts are prevented before anything is created, and server capacity is checked first.
- **Automatic public routing** — Bot-Hosting exposes one TCP port; the panel routes each FakeTLS connection to the right engine by the domain inside its ClientHello (SNI), so every proxy keeps its own shareable links.
- **Dark & light modes** — instant, no-reload switching; the logo, background artwork and all colors follow the theme. The choice is remembered across visits.
- **Persian & English** — full translations, RTL/LTR layout switching without a reload, and a self-hosted Persian typeface (Vazirmatn).
- **Built-in guide** — a complete step-by-step manual (from first login to maintenance) in both languages.
- **QR codes** — every proxy's connection link is shown as a scannable QR code; the encoder is bundled, dependency-free and verified.
- **Lean by design** — Python standard library only on the server, zero frontend frameworks, no external requests from the panel UI.

## Deployment

See **[docs/SETUP.md](docs/SETUP.md)** for installation, upgrading from the previous version, and environment variables. `main.py` is the Bot-Hosting entry file (Python 3.12).

## Repository layout

```
main.py                  Bot-Hosting entry point (engine download, public port router)
panel/server.py          Management panel: auth, multi-proxy manager, API
panel/index.html         Panel UI (single page, dark/light, FA/EN)
panel/app.js             Client logic, translations, guide, QR rendering
panel/qr.js              Dependency-free QR encoder
panel/aral.css           Visual foundation + light theme + RTL
panel/style.css          Component styles
panel/assets/            Logos, backgrounds, favicon, fonts
hosting/port_router.py   Public-port multiplexer (HTTP + SNI-based MTProto routing)
hosting/network.py       Public address discovery and verification
bridge/                  Cloudflare Worker bridge files
scripts/                 Test suite (unit + protocol tests)
docs/                    Setup, changelog, test report
```
