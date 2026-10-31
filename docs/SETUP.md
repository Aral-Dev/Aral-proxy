# ARAL Proxy: Bot-Hosting setup

This repository supports Bot-Hosting's Python runtime. Use `main.py` as the
entry file. You do not need Docker, root access, pip packages or a separate disk
volume. State is stored in `.data/` on the deployment's persistent storage.

## Create the deployment

1. In Bot-Hosting create a deployment from your repository.
2. Select the **Python** runtime, version **3.12**, and branch **main** (or your chosen branch).
3. Set **Entry file** to `main.py`. If using a custom startup command, use
   `python3 -u main.py` from the deployment root.
4. Stay within your free resource pool. No paid package is required by the code.
5. Enable the deployment's public HTTPS subdomain.

## Networking is automatic

Leave PUBLIC_HOST, PUBLIC_PORT and PANEL_PUBLIC_ORIGIN unset for normal deployment.
The application reads SERVER_PORT from the host. If SERVER_IP is not a usable
public address, it discovers the node's public IPv4 and checks a per-process
identity response through the allocated port before publishing a link.

Open your HTTPS panel URL to set up the owner password. Once ownership is verified,
the app records that URL automatically for Worker generation. No account API key
is required. Wrong `.apps` aliases in PUBLIC_HOST are ignored rather than put into
native Telegram links.

For advanced environments only, PUBLIC_HOST can supply a real node hostname;
it must still pass verification. PANEL_PUBLIC_ORIGIN can override HTTPS origin
detection for a custom domain. PANEL_STORAGE_LIMIT_MB defaults to 512 on the free
plan and can be adjusted for another storage allocation.

Leave PANEL_PASSWORD and PANEL_PASSWORD_HASH unset to choose your password in the
browser. Existing owner password files are preserved across updates.

## Start and sign in

Start the deployment. First boot downloads pinned Telemt 3.5.14 from its official
release and verifies the archive checksum. The executable is cached in `.cache/`.

- If `PANEL_PASSWORD` (or `PANEL_PASSWORD_HASH`) is set, sign in with it.
- Otherwise the first boot prints a one-time setup code in the deployment logs.
  Open the panel, enter that code and choose an owner password (8+ characters).

## Upgrading from the previous (single-proxy) version

1. Replace the deployment files with this version and **keep the same persistent
   storage** (`.data/`).
2. On the first boot the panel migrates the old state automatically:
   - the previous proxy secret, sponsor settings, WEB bridge configuration and
     traffic counters become the new **"Main proxy"** entry;
   - every existing connection link keeps working unchanged;
   - the old files are left in place, so rolling back to the previous version is
     also safe.
3. Sign in with your previous owner password (or `PANEL_PASSWORD`).

## Managing multiple proxies

Open **Proxies → New proxy**. Each instance is a separate Telemt process with:

- its **own name** (unique, up to 64 characters);
- its **own engine port** (leave empty for automatic allocation, or pick a free
  TCP port between 1024 and 65535; occupied or reserved ports are rejected);
- its **own masking domain** (FakeTLS host). It must be unique per proxy — this
  is what lets the panel share the platform's single public port between all
  proxies: each client's TLS ClientHello names its proxy's domain, and the
  public-port router dispatches the connection to the right engine;
- its **own links, QR code, statistics, sponsored channel and WEB bridge**.

Limits and guards:

- `PANEL_MAX_PROXIES` (default 8) caps the number of instances;
- creation is refused when memory or disk usage is critically high;
- deleting a proxy stops its engine and removes its data permanently.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PANEL_PASSWORD` / `PANEL_PASSWORD_HASH` | unset | Owner password (plain or SHA-256 hex). If unset, the first-boot setup code is used. |
| `PANEL_MAX_PROXIES` | `8` | Maximum number of proxy instances (1–32). |
| `PANEL_STORAGE_LIMIT_MB` | `512` | Deployment storage quota used for the disk gauge. |
| `PANEL_PUBLIC_ORIGIN` / `PANEL_PUBLIC_DOMAIN` | unset | Override HTTPS origin detection for custom domains. |
| `PUBLIC_HOST` / `SERVER_IP` | unset | Advanced: public host override (still verified before use). |
| `SECRET` | generated | Initial FakeTLS secret of the migrated default proxy. Afterwards the panel-managed secret is authoritative. |
| `FAKE_TLS_HOST` | `www.cloudflare.com` | Masking domain used for the first proxy when none is configured. |
| `TELEMT_BIN` | downloaded | Path to the Telemt engine (set automatically by `main.py`). |

Everything else (`SERVER_PORT`, `HTTP_PORT`, `MTPROTO_PORT`, `METRICS_PORT`,
`TELEMT_API_PORT`, `WEB_LISTEN_PORT`, `TCP_ROUTER_PROXY_PROTOCOL`,
`PANEL_DATA_DIR`, `PANEL_PERSISTENT_DATA`) is configured automatically for
Bot-Hosting deployments.

## Panel features

- **Dark / light mode** — toggle in the header; stored per browser. The ARAL
  logo and background artwork follow the theme.
- **Persian / English** — toggle in the header; layout direction (RTL/LTR)
  switches instantly without a reload.
- **Guide** — a complete, version-matched manual in both languages.
- **Connection links & QR** — per proxy, once the public address is verified.
- **Sponsored channel** — per proxy, with step-by-step registration help.
- **Cloudflare WEB bridge** — per proxy, phone-friendly deployment flow.

## Telegram

Join the channel for news and updates: **[t.me/AralDev](https://t.me/AralDev)**.
