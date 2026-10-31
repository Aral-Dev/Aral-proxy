"""ARAL Proxy management panel for the Bot-Hosting Telemt deployment."""
import base64
import hashlib
import hmac
import http.cookies
import http.client
import ipaddress
import io
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import signal
import socket
import subprocess
import threading
import time
import zipfile
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
BRIDGE_ROOT = ROOT.parent / "bridge"
sys.path.insert(0, str(ROOT.parent))
from hosting.network import PublicNetwork, panel_origin

DEFAULT_TLS_HOST = "www.cloudflare.com"
TLS_HOST_SUGGESTIONS = ["www.google.com", "www.microsoft.com", "www.bing.com", "www.apple.com",
                        "www.amazon.com", "www.linkedin.com", "www.reddit.com", "www.wikipedia.org",
                        "www.office.com", "www.icloud.com", "www.wordpress.com", "www.github.com"]
MAX_PROXIES_DEFAULT = 8

ASSET_TYPES = {"dark-logo.png": "image/png", "light-logo.png": "image/png",
               "dark-background.png": "image/png", "light-background.png": "image/png",
               "favicon.png": "image/png", "vazir.woff2": "font/woff2", "vazir-bold.woff2": "font/woff2"}


class PanelError(ValueError):
    """User-facing validation error carrying a stable code for localization."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


class Resources:
    """Linux container counters, normalized to its CPU and memory allocation."""
    def __init__(self, directory, cgroup=Path("/sys/fs/cgroup")):
        self.directory = directory
        self.cgroup = Path(cgroup)
        self.previous = None
        self.cached = {}
        self.sampled = 0
        self.lock = threading.Lock()

    def snapshot(self):
        with self.lock:
            now = time.monotonic()
            if now - self.sampled < 2:
                return self.cached
            result = {"cpu_percent": None, "cpu_cores": None, "memory_used": None, "memory_limit": None,
                      "memory_percent": None, "disk_used": None, "disk_total": None, "disk_percent": None, "disk_scope": "filesystem"}
            try:
                cores = len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else (os.cpu_count() or 1)
                quota, period = (self.cgroup / "cpu.max").read_text().split()
                if quota != "max":
                    cores = min(cores, int(quota) / int(period))
                cpu = dict(line.split() for line in (self.cgroup / "cpu.stat").read_text().splitlines())
                used = int(cpu["usage_usec"]) / 1000000
                if self.previous and now > self.previous[0] and used >= self.previous[1]:
                    result["cpu_percent"] = min(100, max(0, (used - self.previous[1]) / (now - self.previous[0]) / cores * 100))
                result["cpu_cores"] = cores
                self.previous = (now, used)
            except (OSError, ValueError, KeyError, ZeroDivisionError):
                pass
            try:
                result["memory_used"] = int((self.cgroup / "memory.current").read_text())
                limit = (self.cgroup / "memory.max").read_text().strip()
                if limit != "max":
                    result["memory_limit"] = int(limit)
                    result["memory_percent"] = min(100, result["memory_used"] / result["memory_limit"] * 100)
            except (OSError, ValueError, ZeroDivisionError):
                pass
            try:
                if os.environ.get("PANEL_STORAGE_ROOT") and os.environ.get("PANEL_STORAGE_LIMIT_MB"):
                    root = Path(os.environ["PANEL_STORAGE_ROOT"])
                    used = sum((Path(folder) / name).lstat().st_size for folder, _, names in os.walk(root) for name in names)
                    total = int(os.environ["PANEL_STORAGE_LIMIT_MB"]) * 1024 * 1024
                    result.update(disk_used=used, disk_total=total, disk_percent=min(100, used / total * 100), disk_scope="deployment")
                else:
                    disk = shutil.disk_usage(self.directory)
                    result.update(disk_used=disk.used, disk_total=disk.total, disk_percent=disk.used / disk.total * 100)
            except (OSError, ValueError, ZeroDivisionError):
                pass
            self.cached, self.sampled = result, now
            return result


def parse_usage_metrics(text):
    values = {}
    for line in text.splitlines():
        match = re.fullmatch(r'([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^\n]*\})?\s+([0-9.eE+\-]+)(?:\s+\d+)?', line)
        if match:
            value = float(match[3])
            if value >= 0 and value < 2 ** 64:
                values[(match[1], match[2] or "")] = int(value)
    def total(name, label=None):
        return sum(v for (n, labels), v in values.items() if n == name and (label is None or label in labels))
    required = "telemt_user_connections_current"
    return {"connections": total(required), "users": total("telemt_user_unique_ips_current"),
            "upload": total("telemt_user_octets_from_client_total"), "download": total("telemt_user_octets_to_client_total"),
            "valid": "# HELP telemt_user_connections_current " in text}

def validate_bridge(data):
    if not isinstance(data, dict):
        raise PanelError("invalid_bridge", "Invalid bridge settings")
    url = str(data.get("worker_url", "")).strip().rstrip("/")
    enabled = data.get("enabled", False)
    if not isinstance(enabled, bool):
        raise PanelError("invalid_bridge_state", "Invalid bridge state")
    if url:
        try:
            parsed = urlsplit(url)
            if (parsed.scheme != "https" or parsed.username or parsed.password or parsed.query or parsed.fragment
                    or parsed.path or parsed.port not in (None, 443)
                    or not re.fullmatch(r"[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+", parsed.hostname or "")):
                raise ValueError()
        except ValueError:
            raise PanelError("invalid_bridge_url", "Enter an HTTPS Worker origin, without a path, query or credentials")
        url = "https://" + parsed.hostname.lower()
    public_ip = str(data.get("public_ip", "")).strip()
    if public_ip:
        try:
            address = ipaddress.ip_address(public_ip)
            if address.version != 4 or not address.is_global:
                raise ValueError
        except ValueError:
            raise PanelError("invalid_bridge_ip", "Public endpoint must be a public IPv4 address")
    if enabled and not url:
        raise PanelError("bridge_url_required", "Enter the deployed Worker URL first")
    return {"worker_url": url, "enabled": enabled, "public_ip": public_ip}


def write_private_json(path, data):
    temp = path.with_suffix(".tmp")
    temp.write_text(json.dumps(data))
    temp.chmod(0o600)
    os.replace(temp, path)


def panel_password_hash():
    digest = os.environ.get("PANEL_PASSWORD_HASH", "").strip()
    if digest:
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise PanelError("invalid_password_hash", "PANEL_PASSWORD_HASH must be a SHA-256 hex digest")
        return digest
    password = os.environ.get("PANEL_PASSWORD", "")
    if len(password) < 8:
        raise PanelError("password_required", "Set PANEL_PASSWORD to a unique password of at least 8 characters, or set PANEL_PASSWORD_HASH")
    return hashlib.sha256(password.encode()).hexdigest()


def bridge_bundle(proxy):
    status = proxy.status()
    state = proxy.bridge
    config = {"name": proxy.worker_name(), "main": "worker.mjs", "compatibility_date": "2026-10-01", "workers_dev": True,
              "vars": {"UPSTREAM_ORIGIN": proxy.hosting_origin()}}
    helper = {"worker_url": state["worker_url"] or "https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev",
              "token": state["token"]}
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name in ("worker.mjs", "worker-core.mjs", "worker-standalone.mjs", "upload-secret.mjs", "README.txt"):
            archive.writestr(name, (BRIDGE_ROOT / name).read_bytes())
        archive.writestr("wrangler.jsonc", json.dumps(config, indent=2))
        archive.writestr("bridge-config.json", json.dumps(helper, indent=2))
        archive.writestr(".gitignore", "bridge-config.json\n.dev.vars\n.wrangler/\nnode_modules/\n")
    return output.getvalue()


def standalone_worker(proxy):
    origin = proxy.hosting_origin()
    if not origin:
        raise PanelError("origin_missing", "Open and sign in through your hosting HTTPS domain first")
    source = (BRIDGE_ROOT / "worker-standalone.mjs").read_text()
    ending = "export default {fetch:createBridgeHandler()};"
    config = json.dumps({"UPSTREAM_ORIGIN": origin, "BRIDGE_TOKEN": proxy.bridge["token"]})
    replacement = "const ARAL_CONFIG = " + config + ";\nconst handle = createBridgeHandler();\nexport default {fetch(request, env, ctx) { return handle(request, {...env, ...ARAL_CONFIG}, ctx); }};"
    return ("// PRIVATE deployment file: contains your bridge token. Do not publish.\n" + source.replace(ending, replacement)).encode()


def decode_secret(value):
    value = value.strip()
    if re.fullmatch(r"[0-9a-fA-F]{32}", value):
        return bytes.fromhex(value), os.environ.get("FAKE_TLS_HOST", DEFAULT_TLS_HOST)
    try:
        raw = bytes.fromhex(value)
    except ValueError:
        raise PanelError("invalid_secret", "A valid FakeTLS secret is required")
    if len(raw) < 19 or raw[0] != 238:
        raise PanelError("invalid_secret", "A valid FakeTLS secret is required")
    try:
        host = raw[17:].decode("ascii")
    except UnicodeDecodeError:
        raise PanelError("invalid_secret", "Invalid FakeTLS hostname")
    if not re.fullmatch(r"[A-Za-z0-9.-]{1,253}", host):
        raise PanelError("invalid_secret", "Invalid FakeTLS hostname")
    return raw[1:17], host


def validate_settings(data):
    if not isinstance(data, dict) or not isinstance(data.get("enabled", False), bool):
        raise PanelError("invalid_settings", "Invalid settings")
    enabled = data.get("enabled", False)
    tag = str(data.get("ad_tag", "")).strip().lower()
    channel = str(data.get("channel", "")).strip().removeprefix("https://t.me/").lstrip("@")
    if tag and not re.fullmatch(r"[a-f0-9]{32}", tag):
        raise PanelError("invalid_ad_tag", "Promotion tag must contain exactly 32 hexadecimal characters")
    if enabled and not tag:
        raise PanelError("ad_tag_required", "Get a promotion tag from @MTProxybot before enabling sponsorship")
    if channel and not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{4,31}", channel):
        raise PanelError("invalid_channel", "Enter a public channel username, such as @mychannel")
    return {"enabled": enabled, "ad_tag": tag, "channel": channel}


def telemt_config(secret, settings, port, bridge=None, decoy_directory=None,
                  metrics_port=None, api_port=None, web_port=None, routed=None):
    key, host = decode_secret(secret)
    # JSON strings are also valid TOML basic strings for these validated fields.
    tag = settings["ad_tag"]
    if routed is None:
        routed = os.environ.get("TCP_ROUTER_PROXY_PROTOCOL") == "1"
    decoy_directory = decoy_directory or "/data/web-decoy"
    metrics_port = int(metrics_port or os.environ.get("METRICS_PORT", "9090"))
    api_port = int(api_port or os.environ.get("TELEMT_API_PORT", "9091"))
    web_port = int(web_port or os.environ.get("WEB_LISTEN_PORT", "18080"))
    result = f'''[general]
use_middle_proxy = {str(settings.get("enabled", True)).lower()}
ad_tag = {json.dumps(tag)}
log_level = "normal"
middle_proxy_nat_probe = true

[general.modes]
classic = false
secure = false
tls = true

[server]
port = {port}
metrics_listen = "127.0.0.1:{metrics_port}"

[[server.listeners]]
ip = "{'127.0.0.1' if routed else '0.0.0.0'}"
proxy_protocol = {str(routed).lower()}

[server.api]
enabled = true
listen = "127.0.0.1:{api_port}"
whitelist = ["127.0.0.1/32"]
read_only = true

[censorship]
tls_domain = {json.dumps(host)}
mask = true
tls_emulation = true

[access]
ignore_time_skew = false

[access.users]
owner = "{key.hex()}"
'''
    if bridge and bridge["enabled"]:
        worker_host = urlsplit(bridge["worker_url"]).hostname
        result += f'''
[[server.listeners]]
ip = "127.0.0.1"
port = {web_port}
transport = "web"
proxy_protocol = false
web_client_ip_source = "x_forwarded_for"
web_trusted_proxy_cidrs = ["127.0.0.1/32"]

[web]
enabled = true
carrier = "https"
carriers = false
decoy_fasttrack_mode = "off"
http_connection_capacity_action = "drop"

[[web.vhosts]]
host = {json.dumps(worker_host)}
public_addr = "{bridge['public_ip']}:443"

[web.vhosts.decoy]
mode = "static_directory"
directory = {json.dumps(str(decoy_directory))}

[[web.vhosts.profiles]]
user = "owner"
secret_mode = "dd"
max_sessions = 64
max_streams = 2048
max_streams_per_session = 64
'''
    return result


class Proxy:
    """One independently managed Telemt engine instance."""

    def __init__(self, directory, record, network, routed):
        proxy_id = str(record.get("id", ""))
        if not re.fullmatch(r"[a-z0-9]{2,32}", proxy_id):
            raise PanelError("invalid_id", "Invalid proxy identifier")
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.network = network
        self.routed = bool(routed)
        self.id = proxy_id
        self.name = str(record["name"])
        self.is_default = bool(record.get("is_default"))
        self.port = int(record["port"])
        self.web_port = int(record["web_port"])
        self.metrics_port = int(record["metrics_port"])
        self.api_port = int(record["api_port"])
        self.tls_host = str(record["tls_host"])
        self.secret = str(record["secret"])
        self.enabled = bool(record.get("enabled", True))
        self.created_at = int(record.get("created_at") or time.time())
        if self.is_default and os.environ.get("SECRET", "").strip():
            self.secret = os.environ["SECRET"].strip()  # environment override stays authoritative for the migrated proxy
        decode_secret(self.secret)
        self.settings = validate_settings(record.get("settings") or {})
        bridge = record.get("bridge") or {}
        self.bridge = {**validate_bridge(bridge), "token": str(bridge.get("token") or secrets.token_urlsafe(32))}
        self.usage_path = self.directory / "usage.json"
        saved_usage = None
        if self.usage_path.exists():
            try:
                saved_usage = json.loads(self.usage_path.read_text())
            except (OSError, ValueError):
                saved_usage = None
        self.usage = {"upload_bytes": 0, "download_bytes": 0, "since": int(time.time())}
        if isinstance(saved_usage, dict):
            for key in ("upload_bytes", "download_bytes"):
                value = saved_usage.get(key)
                if isinstance(value, int) and 0 <= value < 2 ** 63:
                    self.usage[key] = value
            since = saved_usage.get("since")
            if isinstance(since, int) and 0 < since < 2 ** 33:
                self.usage["since"] = since
        self.usage_last = (0, 0)
        self.usage_sampled = 0
        self.usage_saved = 0
        self.live_usage = {"available": False, "users": None, "connections": None}
        self.process = None
        self.lock = threading.RLock()
        self.started = time.time()
        self.switching = False

    def record(self):
        # Per-proxy usage lives in its own usage.json to avoid rewriting the
        # whole registry on every statistics sample.
        return {"id": self.id, "name": self.name, "is_default": self.is_default, "port": self.port,
                "web_port": self.web_port, "metrics_port": self.metrics_port, "api_port": self.api_port,
                "tls_host": self.tls_host, "secret": self.secret, "enabled": self.enabled,
                "created_at": self.created_at, "settings": self.settings, "bridge": self.bridge}

    def worker_name(self):
        # Stable per proxy, derived from its randomly generated private token.
        return "aral-proxy-tg-" + hashlib.sha256(self.bridge["token"].encode()).hexdigest()[:8]

    def hosting_origin(self):
        if os.environ.get("PANEL_PUBLIC_ORIGIN"):
            return validate_bridge({"worker_url": os.environ["PANEL_PUBLIC_ORIGIN"]})["worker_url"]
        if os.environ.get("PANEL_PUBLIC_DOMAIN"):
            return "https://" + os.environ["PANEL_PUBLIC_DOMAIN"]
        return self.network.origin

    def start(self):
        env = os.environ.copy()
        env["SECRET"] = self.secret
        path = self.directory / "telemt.toml"
        decoy = self.directory / "web-decoy"
        decoy.mkdir(exist_ok=True)
        (decoy / "index.html").write_text("<!doctype html><title>Welcome</title><h1>Welcome</h1>")
        path.write_text(telemt_config(self.secret, self.settings, self.port, self.bridge, str(decoy),
                                      metrics_port=self.metrics_port, api_port=self.api_port,
                                      web_port=self.web_port, routed=self.routed))
        path.chmod(0o600)
        command = [os.environ.get("TELEMT_BIN", "telemt"), str(path)]
        self.process = subprocess.Popen(command, env=env, cwd=self.directory)
        self.started = time.time()
        self.usage_last = (0, 0)
        self.usage_sampled = 0
        self.live_usage = {"available": False, "users": None, "connections": None}

    def stop(self):
        if self.process and self.process.poll() is None:
            self.sample_usage(force=True)
            self.process.terminate()
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait()

    def running(self):
        return self.process is not None and self.process.poll() is None

    def sample_usage(self, force=False):
        with self.lock:
            now = time.monotonic()
            if not force and now - self.usage_sampled < 5:
                return
            self.usage_sampled = now
            if not self.running():
                self.live_usage = {"available": False, "users": None, "connections": None}
                return
            connection = http.client.HTTPConnection("127.0.0.1", self.metrics_port, timeout=2)
            try:
                connection.request("GET", "/metrics")
                response = connection.getresponse()
                text = response.read(4 * 1024 * 1024 + 1)
                if response.status != 200 or len(text) > 4 * 1024 * 1024:
                    raise ValueError("Metrics unavailable")
                metric = parse_usage_metrics(text.decode())
                if not metric["valid"]:
                    raise ValueError("Metrics unavailable")
                current = (metric["upload"], metric["download"])
                for index, key in enumerate(("upload_bytes", "download_bytes")):
                    previous = self.usage_last[index]
                    self.usage[key] += current[index] - previous if current[index] >= previous else current[index]
                self.usage_last = current
                self.live_usage = {"available": True, "users": metric["users"], "connections": metric["connections"]}
            except (OSError, ValueError, http.client.HTTPException):
                self.live_usage = {"available": False, "users": None, "connections": None}
            finally:
                connection.close()
            if force or now - self.usage_saved >= 30:
                try:
                    write_private_json(self.usage_path, self.usage)
                    self.usage_saved = now
                except OSError:
                    pass

    def ready(self):
        if not self.running():
            return False
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=0.5):
                pass
            if self.bridge["enabled"]:
                with socket.create_connection(("127.0.0.1", self.web_port), timeout=0.5):
                    pass
            return True
        except OSError:
            return False

    def apply(self, data):
        new = validate_settings(data)
        with self.lock:
            old = self.settings
            restart = old["enabled"] != new["enabled"] or (new["enabled"] and old["ad_tag"] != new["ad_tag"])
            if restart:
                self.switching = True
                try:
                    self.stop()
                    self.settings = new
                    self.start()
                    deadline = time.monotonic() + 40
                    while not self.ready():
                        if self.process.poll() is not None or time.monotonic() > deadline:
                            raise PanelError("engine_start_failed", "New engine did not start. Previous settings restored.")
                        time.sleep(0.5)
                except Exception:
                    self.settings = old
                    self.stop()
                    self.start()
                    raise
                finally:
                    self.switching = False
            else:
                self.settings = new
            return new

    def apply_bridge(self, data):
        new = validate_bridge(data)
        if new["enabled"] and not new["public_ip"]:
            try:
                new["public_ip"] = socket.gethostbyname(urlsplit(new["worker_url"]).hostname)
                new = validate_bridge(new)
            except OSError:
                raise PanelError("worker_unresolved", "Worker hostname could not be resolved")
        with self.lock:
            new["token"] = self.bridge["token"]
            old = self.bridge
            # A bridge that stays disabled needs no engine restart; only persist.
            needs_restart = new["enabled"] and (not old["enabled"] or new["worker_url"] != old["worker_url"] or new["public_ip"] != old["public_ip"])
            if not needs_restart and not (new["enabled"] != old["enabled"]):
                self.bridge = new
                return
            self.switching = True
            try:
                self.bridge = new
                self.stop()
                self.start()
                deadline = time.monotonic() + 40
                while not self.ready():
                    if self.process.poll() is not None or time.monotonic() > deadline:
                        raise PanelError("web_start_failed", "WEB proxy could not start; previous settings restored")
                    time.sleep(0.5)
            except Exception:
                self.bridge = old
                self.stop()
                self.start()
                raise
            finally:
                self.switching = False

    def set_port(self, port):
        with self.lock:
            old = self.port
            was_running = self.running()
            self.switching = True
            try:
                self.port = port
                if was_running:
                    self.stop()
                    self.start()
                    deadline = time.monotonic() + 40
                    while not self.ready():
                        if self.process.poll() is not None or time.monotonic() > deadline:
                            raise PanelError("engine_start_failed", "Engine did not start on the new port; previous port restored.")
            except Exception:
                self.port = old
                self.stop()
                self.start()
                raise
            finally:
                self.switching = False

    def set_enabled(self, enabled):
        with self.lock:
            if enabled and not self.running():
                self.start()
            elif not enabled and self.running():
                self.stop()

    def status(self):
        self.sample_usage()
        key, _ = decode_secret(self.secret)
        public_host = self.network.host
        if self.routed:
            public_port = str(self.network.public_port) if self.network.public_port else ""
        else:
            public_port = str(self.port)
        full = (b"\xee" + key + self.tls_host.encode()).hex()
        params = f"server={public_host}&port={public_port}&secret={full}"
        web_params = f"server={urlsplit(self.bridge['worker_url']).hostname or ''}&secret=dd{key.hex()}"
        return {"id": self.id, "name": self.name, "is_default": self.is_default,
                "enabled": self.enabled, "running": self.ready(), "port": self.port,
                "public_port": public_port, "host": public_host, "tls_host": self.tls_host,
                "uptime": int(time.time() - self.started) if self.running() else 0,
                "settings": self.settings,
                "tg_link": "tg://proxy?" + params if public_host else "",
                "web_link": "https://t.me/proxy?" + params if public_host else "",
                "network_ready": bool(public_host),
                "registration_secret": key.hex(),
                "usage": {**self.usage, **self.live_usage, "total_bytes": self.usage["upload_bytes"] + self.usage["download_bytes"]},
                "bridge": {"worker_url": self.bridge["worker_url"], "enabled": self.bridge["enabled"],
                           "worker_name": self.worker_name(), "hosting_origin": self.hosting_origin(),
                           "public_ip": self.bridge["public_ip"], "configured": self.bridge["enabled"],
                           "tg_link": "tg://webproxy?" + web_params if self.bridge["enabled"] else ""}}


def validate_proxy_name(value, taken):
    name = str(value or "").strip()
    if not 1 <= len(name) <= 64:
        raise PanelError("invalid_name", "Choose a name between 1 and 64 characters")
    if name.casefold() in {t.casefold() for t in taken}:
        raise PanelError("name_taken", "A proxy with this name already exists")
    return name


def validate_tls_host(value):
    host = str(value or "").strip().lower().rstrip(".")
    if not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+", host) or len(host) > 253:
        raise PanelError("invalid_tls_host", "Enter a valid masking domain, such as www.cloudflare.com")
    return host


class ProxyManager:
    """Owns every proxy instance, their persistence, and the router map."""

    def __init__(self, directory):
        self.directory = Path(directory)
        self.proxies_dir = self.directory / "proxies"
        self.proxies_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.directory / "proxies.json"
        self.resources = Resources(str(self.directory))
        self.network = PublicNetwork(self.directory, int(os.environ.get("SERVER_PORT") or os.environ.get("PUBLIC_PORT") or "0"))
        self.routed = os.environ.get("TCP_ROUTER_PROXY_PROTOCOL") == "1"
        self.public_port = int(os.environ.get("SERVER_PORT") or os.environ.get("PUBLIC_PORT") or "0")
        self.http_port = int(os.environ.get("HTTP_PORT") or os.environ.get("PORT") or "8080")
        self.max_proxies = self._env_int("PANEL_MAX_PROXIES", MAX_PROXIES_DEFAULT, 1, 32)
        self.lock = threading.RLock()
        self.proxies = []
        self._load()

    def _env_int(self, name, default, low, high):
        try:
            return max(low, min(high, int(os.environ.get(name, str(default)))))
        except ValueError:
            return default

    # ---------- persistence ----------

    def _save(self):
        write_private_json(self.path, {"proxies": [proxy.record() for proxy in self.proxies]})

    def _load(self):
        if self.path.exists():
            try:
                data = json.loads(self.path.read_text())
                for entry in data.get("proxies", []):
                    try:
                        self.proxies.append(Proxy(self.proxies_dir / entry["id"], entry, self.network, self.routed))
                    except (KeyError, ValueError, OSError, PanelError) as error:
                        print(f"[panel] skipping unreadable proxy record: {type(error).__name__}", flush=True)
                return
            except (OSError, ValueError):
                print("[panel] proxies.json unreadable; rebuilding from legacy data", flush=True)
        if self._migrate_legacy():
            print("[panel] migrated previous single-proxy data; existing links stay valid", flush=True)
        else:
            self._bootstrap_first()
        self._save()

    def _migrate_legacy(self):
        directory = self.directory
        sponsor_path = directory / "sponsor.json"
        secret_path = directory / "proxy-secret.json"
        if not sponsor_path.exists() and not secret_path.exists():
            return False
        secret = os.environ.get("SECRET", "").strip()
        if not secret and secret_path.exists():
            try:
                secret = json.loads(secret_path.read_text())["secret"]
            except (OSError, ValueError, KeyError):
                secret = ""
        if not secret:
            host = os.environ.get("FAKE_TLS_HOST", DEFAULT_TLS_HOST)
            secret = "ee" + secrets.token_hex(16) + host.encode("ascii").hex()
        key, host = decode_secret(secret)
        try:
            settings = validate_settings(json.loads(sponsor_path.read_text())) if sponsor_path.exists() else validate_settings({})
        except (OSError, ValueError):
            settings = validate_settings({})
        bridge = None
        bridge_path = directory / "bridge.json"
        if bridge_path.exists():
            try:
                bridge = json.loads(bridge_path.read_text())
            except (OSError, ValueError):
                bridge = None
        usage = None
        usage_path = directory / "usage.json"
        if usage_path.exists():
            try:
                usage = json.loads(usage_path.read_text())
            except (OSError, ValueError):
                usage = None
        record = {"id": "main", "name": "Main proxy", "is_default": True,
                  "port": self._env_int("MTPROTO_PORT", 3128, 1024, 65535),
                  "web_port": self._env_int("WEB_LISTEN_PORT", 18080, 1024, 65535),
                  "metrics_port": self._env_int("METRICS_PORT", 9090, 1024, 65535),
                  "api_port": self._env_int("TELEMT_API_PORT", 9091, 1024, 65535),
                  "tls_host": host, "secret": secret, "enabled": True, "created_at": int(time.time()),
                  "settings": settings, "bridge": bridge or {}}
        proxy_dir = self.proxies_dir / "main"
        proxy_dir.mkdir(parents=True, exist_ok=True)
        if isinstance(usage, dict):
            try:
                write_private_json(proxy_dir / "usage.json", usage)
            except OSError:
                pass
        self.proxies.append(Proxy(proxy_dir, record, self.network, self.routed))
        return True

    def _bootstrap_first(self):
        host = os.environ.get("FAKE_TLS_HOST", DEFAULT_TLS_HOST)
        secret = "ee" + secrets.token_hex(16) + host.encode("ascii").hex()
        record = {"id": "main", "name": "Main proxy", "is_default": True,
                  "port": self._env_int("MTPROTO_PORT", 3128, 1024, 65535),
                  "web_port": self._env_int("WEB_LISTEN_PORT", 18080, 1024, 65535),
                  "metrics_port": self._env_int("METRICS_PORT", 9090, 1024, 65535),
                  "api_port": self._env_int("TELEMT_API_PORT", 9091, 1024, 65535),
                  "tls_host": host, "secret": secret, "enabled": True, "created_at": int(time.time()),
                  "settings": validate_settings({}), "bridge": {}}
        self.proxies.append(Proxy(self.proxies_dir / "main", record, self.network, self.routed))

    # ---------- lookups ----------

    def get(self, proxy_id):
        for proxy in self.proxies:
            if proxy.id == proxy_id:
                return proxy
        return None

    def find_by_bridge_token(self, token):
        if not token:
            return None
        for proxy in self.proxies:
            if hmac.compare_digest(proxy.bridge["token"], token):
                return proxy
        return None

    # ---------- ports and capacity ----------

    def reserved_ports(self):
        ports = {self.http_port}
        if self.public_port:
            ports.add(self.public_port)
        for proxy in self.proxies:
            ports.update((proxy.port, proxy.web_port, proxy.metrics_port, proxy.api_port))
        return ports

    def port_bindable(self, port):
        address = "127.0.0.1" if self.routed else "0.0.0.0"
        test = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            # SO_REUSEADDR ignores TIME_WAIT leftovers, exactly like a fresh real
            # listener would; only an active service keeps the port unavailable.
            test.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            test.bind((address, port))
            return True
        except OSError:
            return False
        finally:
            test.close()

    def _check_port(self, port):
        if not isinstance(port, int) or not 1024 <= port <= 65535:
            raise PanelError("invalid_port", "Choose a TCP port between 1024 and 65535")
        if port in self.reserved_ports():
            raise PanelError("port_taken", "This port is already reserved by the panel or another proxy")
        if not self.port_bindable(port):
            raise PanelError("port_in_use", "This port is occupied by another service on this server")
        return port

    def allocate_ports(self, want_port=None):
        port = self._check_port(want_port) if want_port is not None else None
        if port is None:
            port = self._scan_from(self._env_int("MTPROTO_PORT", 3128, 1024, 65535))
        metrics = self._scan_from(self._env_int("METRICS_PORT", 9090, 1024, 65535), extra={port})
        api = self._scan_from(self._env_int("TELEMT_API_PORT", 9091, 1024, 65535), extra={port, metrics})
        web = self._scan_from(self._env_int("WEB_LISTEN_PORT", 18080, 1024, 65535), extra={port, metrics, api})
        return {"port": port, "metrics_port": metrics, "api_port": api, "web_port": web}

    def _scan_from(self, start, extra=frozenset()):
        taken = self.reserved_ports() | set(extra)
        port = start
        while port <= 65535:
            if port not in taken and self.port_bindable(port):
                return port
            port += 1
        raise PanelError("no_free_port", "No free TCP port could be found for a new proxy")

    def _capacity_ok(self):
        if len(self.proxies) >= self.max_proxies:
            raise PanelError("limit_reached", f"At most {self.max_proxies} proxies can run on this server")
        resources = self.resources.snapshot()
        if resources.get("memory_percent") is not None and resources["memory_percent"] >= 90:
            raise PanelError("capacity_memory", "Server memory is nearly exhausted; free resources before adding a proxy")
        if resources.get("disk_percent") is not None and resources["disk_percent"] >= 95:
            raise PanelError("capacity_disk", "Server storage is nearly full; free space before adding a proxy")

    # ---------- CRUD ----------

    def create(self, data):
        if not isinstance(data, dict):
            raise PanelError("invalid_request", "Invalid request")
        with self.lock:
            self._capacity_ok()
            name = validate_proxy_name(data.get("name"), [p.name for p in self.proxies])
            want_port = data.get("port")
            if want_port is not None:
                try:
                    want_port = int(want_port)
                except (TypeError, ValueError):
                    raise PanelError("invalid_port", "Choose a TCP port between 1024 and 65535")
            ports = self.allocate_ports(want_port)
            host = self._choose_tls_host(data.get("tls_host"))
            key = secrets.token_hex(16)
            secret = "ee" + key + host.encode("ascii").hex()
            proxy_id = secrets.token_hex(6)
            record = {"id": proxy_id, "name": name, "is_default": False, "enabled": True,
                      "created_at": int(time.time()), "tls_host": host, "secret": secret,
                      "settings": validate_settings({}), "bridge": {}, **ports}
            proxy = Proxy(self.proxies_dir / proxy_id, record, self.network, self.routed)
            self.proxies.append(proxy)
            try:
                self._start_with_check(proxy)
            except PanelError:
                self._discard(proxy)
                raise
            self._save()
            self._publish_router()
            print(f"[panel] proxy '{name}' created on internal port {proxy.port}", flush=True)
            return proxy

    def _choose_tls_host(self, want):
        used = {p.tls_host for p in self.proxies}
        if want is not None and str(want).strip():
            host = validate_tls_host(want)
            if host in used:
                raise PanelError("tls_host_taken", "This masking domain is already used by another proxy")
            return host
        if DEFAULT_TLS_HOST not in used:
            return DEFAULT_TLS_HOST
        for candidate in TLS_HOST_SUGGESTIONS:
            if candidate not in used:
                return candidate
        raise PanelError("tls_host_required", "All suggested masking domains are used; provide a unique one")

    def _start_with_check(self, proxy):
        proxy.switching = True
        try:
            proxy.stop()
            proxy.start()
            deadline = time.monotonic() + 40
            while not proxy.ready():
                if proxy.process.poll() is not None or time.monotonic() > deadline:
                    raise PanelError("engine_start_failed", "The proxy engine did not start; check the deployment logs")
                time.sleep(0.25)
        finally:
            proxy.switching = False

    def _discard(self, proxy):
        try:
            proxy.stop()
        except Exception:
            pass
        if proxy in self.proxies:
            self.proxies.remove(proxy)
        shutil.rmtree(proxy.directory, ignore_errors=True)

    def update(self, proxy_id, data):
        if not isinstance(data, dict):
            raise PanelError("invalid_request", "Invalid request")
        with self.lock:
            proxy = self.get(proxy_id)
            if not proxy:
                raise PanelError("not_found", "Proxy not found")
            if "name" in data:
                proxy.name = validate_proxy_name(data.get("name"), [p.name for p in self.proxies if p.id != proxy_id])
            if "port" in data:
                try:
                    port = int(data.get("port"))
                except (TypeError, ValueError):
                    raise PanelError("invalid_port", "Choose a TCP port between 1024 and 65535")
                if port != proxy.port:
                    if port in self.reserved_ports() or not self.port_bindable(port):
                        raise PanelError("port_taken", "This port is already reserved by the panel or another proxy")
                    proxy.set_port(port)
            if "sponsor" in data:
                proxy.apply(data.get("sponsor") or {})
            if "bridge" in data:
                proxy.apply_bridge(data.get("bridge") or {})
            if "enabled" in data:
                if not isinstance(data.get("enabled"), bool):
                    raise PanelError("invalid_request", "Invalid request")
                proxy.enabled = data["enabled"]
                proxy.set_enabled(proxy.enabled)
            self._save()
            self._publish_router()
            return proxy

    def delete(self, proxy_id):
        with self.lock:
            proxy = self.get(proxy_id)
            if not proxy:
                raise PanelError("not_found", "Proxy not found")
            if proxy.switching:
                raise PanelError("busy", "This proxy is applying changes; try again in a moment")
            proxy.stop()
            self.proxies.remove(proxy)
            shutil.rmtree(proxy.directory, ignore_errors=True)
            self._save()
            self._publish_router()
            print(f"[panel] proxy '{proxy.name}' deleted", flush=True)

    # ---------- lifecycle ----------

    def start_all(self):
        for proxy in self.proxies:
            if proxy.enabled:
                try:
                    proxy.start()
                except OSError as error:
                    print(f"[panel] could not start '{proxy.name}': {type(error).__name__}", flush=True)
        self._publish_router()

    def stop_all(self):
        for proxy in self.proxies:
            proxy.stop()

    def maintain(self):
        with self.lock:
            for proxy in self.proxies:
                if proxy.switching:
                    continue
                if proxy.enabled and proxy.process is not None and proxy.process.poll() is not None:
                    print(f"[panel] proxy '{proxy.name}' exited; restarting", flush=True)
                    try:
                        proxy.start()
                    except OSError:
                        pass
                proxy.sample_usage()

    def _publish_router(self):
        entries, default_port = [], 0
        for proxy in self.proxies:
            if proxy.enabled:
                entries.append({"host": proxy.tls_host, "port": proxy.port})
                if not default_port:
                    default_port = proxy.port
        payload = {"proxies": entries, "default_port": default_port, "updated": int(time.time())}
        path = self.directory / "router.json"
        temp = path.with_suffix(".tmp")
        temp.write_text(json.dumps(payload))
        temp.chmod(0o600)
        os.replace(temp, path)

    def status(self):
        resources = self.resources.snapshot()
        server = {"engine": "Telemt", "routed": self.routed, "host": self.network.host,
                  "public_port": self.public_port or None, "network_ready": bool(self.network.host),
                  "max_proxies": self.max_proxies, "resources": resources,
                  "persistent": os.environ.get("PANEL_PERSISTENT_DATA") == "1"}
        return {"server": server, "proxies": [proxy.status() for proxy in self.proxies]}


class App:
    def __init__(self, manager, password_hash, setup_code=None):
        self.manager = manager
        self.password_hash = password_hash
        self.sessions = {}
        self.attempts = []
        self.lock = threading.Lock()
        self.bridge_slots = threading.BoundedSemaphore(128)
        self.setup_code = setup_code

    def configure(self, code, password):
        with self.lock:
            if self.password_hash or not self.setup_code:
                raise PanelError("already_configured", "This deployment is already configured")
            now = time.time()
            self.attempts = [x for x in self.attempts if now - x < 60]
            if len(self.attempts) >= 10:
                raise PanelError("too_many_attempts", "Too many attempts. Wait one minute")
            self.attempts.append(now)
            if not hmac.compare_digest(hashlib.sha256(code.encode()).digest(), hashlib.sha256(self.setup_code.encode()).digest()):
                raise PanelError("bad_setup_code", "Incorrect setup code")
            if not 8 <= len(password) <= 256:
                raise PanelError("invalid_password", "Choose a password between 8 and 256 characters")
            salt = secrets.token_hex(16)
            digest = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 310000).hex()
            stored = "pbkdf2_sha256$310000$" + salt + "$" + digest
            write_private_json(self.manager.directory / "owner.json", {"password_hash": stored})
            self.password_hash = stored
            self.setup_code = None
            try:
                (self.manager.directory / "setup-code.json").unlink(missing_ok=True)
            except OSError:
                pass  # The saved owner hash and configured state invalidate this code.
            self.attempts = []

    def login(self, password):
        if not self.password_hash:
            return None
        with self.lock:
            now = time.time()
            self.attempts = [x for x in self.attempts if now - x < 60]
            if len(self.attempts) >= 10:
                return None
            self.attempts.append(now)
        if self.password_hash.startswith("pbkdf2_sha256$"):
            _, rounds, salt, expected = self.password_hash.split("$")
            actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
        else:
            expected = self.password_hash
            actual = hashlib.sha256(password.encode()).hexdigest()
        if not hmac.compare_digest(actual, expected):
            return None
        token = secrets.token_urlsafe(32)
        csrf = secrets.token_urlsafe(24)
        with self.lock:
            self.sessions = {k: v for k, v in self.sessions.items() if v["expires"] > now}
            self.sessions[token] = {"expires": now + 8 * 3600, "csrf": csrf}
        return token


def handler_for(app):
    manager = app.manager

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass  # Never log credentials, cookies, or links.

        def reply(self, status, body, content_type="application/json", cookie=None, filename=None):
            raw = json.dumps(body).encode() if isinstance(body, dict) else body
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(raw)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if cookie:
                self.send_header("Set-Cookie", cookie)
            if filename:
                self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.end_headers()
            self.wfile.write(raw)

        def session(self):
            cookies = http.cookies.SimpleCookie()
            try:
                cookies.load(self.headers.get("Cookie", ""))
            except http.cookies.CookieError:
                return None
            token = cookies.get("panel_session")
            with app.lock:
                session = app.sessions.get(token.value) if token else None
            return session if session and session["expires"] > time.time() else None

        def relay_web(self):
            """Only a Worker with a proxy's token can reach its private WEB listener."""
            token = self.headers.get("X-Bridge-Token", "")
            proxy = manager.find_by_bridge_token(token)
            if not proxy or not proxy.bridge["enabled"]:
                return self.reply(404, b"Not found", "text/plain")
            if not app.bridge_slots.acquire(blocking=False):
                return self.reply(503, b"Busy", "text/plain")
            upstream = None
            try:
                self.connection.settimeout(15)
                if self.headers.get("Transfer-Encoding"):
                    return self.reply(400, b"Content-Length required", "text/plain")
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 1024 * 1024:
                    return self.reply(413, b"Request too large", "text/plain")
                body = self.rfile.read(size)
                if len(body) != size:
                    return self.reply(400, b"Incomplete body", "text/plain")
                client_ip = str(ipaddress.ip_address(self.headers.get("X-Bridge-Client-IP", "")))
                blocked = {"host", "connection", "content-length", "transfer-encoding", "upgrade", "cookie", "forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-bridge-token", "x-bridge-client-ip", "accept-encoding", "proxy-authorization", "proxy-connection", "te", "trailer", "keep-alive"}
                headers = {k: v for k, v in self.headers.items() if k.lower() not in blocked}
                headers.update({"Host": urlsplit(proxy.bridge["worker_url"]).hostname, "X-Forwarded-For": client_ip,
                                "Content-Length": str(size), "Connection": "close", "Accept-Encoding": "identity"})
                path = self.path[len("/_webbridge"):]
                if not path.startswith("/") or path.startswith("//"):
                    return self.reply(400, b"Invalid path", "text/plain")
                upstream = http.client.HTTPConnection("127.0.0.1", proxy.web_port, timeout=40)
                upstream.request(self.command, path, body=body, headers=headers)
                response = upstream.getresponse()
                raw = response.read(16 * 1024 * 1024 + 1)
                if len(raw) > 16 * 1024 * 1024:
                    return self.reply(502, b"Response too large", "text/plain")
                self.send_response(response.status)
                for name, value in response.getheaders():
                    if name.lower() not in {"connection", "transfer-encoding", "content-length", "keep-alive", "set-cookie"}:
                        self.send_header(name, value)
                self.send_header("Content-Length", str(len(raw)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                if self.command != "HEAD":
                    self.wfile.write(raw)
            except (ValueError, OSError, http.client.HTTPException):
                self.reply(502, b"Bridge unavailable", "text/plain")
            finally:
                if upstream:
                    upstream.close()
                app.bridge_slots.release()

        def do_HEAD(self):
            if self.path.startswith("/_webbridge/"):
                return self.relay_web()
            return self.reply(404, b"", "text/plain")

        def do_DELETE(self):
            if self.path.startswith("/_webbridge/"):
                return self.relay_web()
            session = self.session()
            if not session or not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]):
                return self.reply(403, {"error": "Session expired; sign in again"})
            path = urlsplit(self.path).path
            match = re.fullmatch(r"/api/proxies/([a-z0-9]{2,32})", path)
            if match:
                try:
                    manager.delete(match[1])
                    return self.reply(200, {"ok": True})
                except PanelError as error:
                    return self.reply(400, {"error": str(error), "code": error.code})
                except Exception:
                    return self.reply(500, {"error": "Could not delete the proxy"})
            return self.reply(404, {"error": "Not found"})

        def do_GET(self):
            if self.path.startswith("/_webbridge/"):
                return self.relay_web()
            path = urlsplit(self.path).path
            if path == "/_network/probe" and hasattr(manager, "network"):
                return self.reply(200, {"instance": manager.network.probe_id})
            if path == "/api/setup/status":
                return self.reply(200, {"required": not bool(app.password_hash)})
            if path == "/health":
                enabled = [p for p in manager.proxies if p.enabled]
                healthy = not enabled or any(p.ready() for p in enabled)
                return self.reply(200 if healthy else 503, b"ok\n" if healthy else b"starting\n", "text/plain")
            if path in ("/", "/panel", "/panel/"):
                return self.reply(200, (ROOT / "index.html").read_bytes(), "text/html; charset=utf-8")
            if path in ("/panel/app.js", "/panel/qr.js", "/panel/style.css", "/panel/aral.css"):
                name = path.rsplit("/", 1)[-1]
                return self.reply(200, (ROOT / name).read_bytes(), "text/javascript" if name.endswith("js") else "text/css")
            if path.startswith("/panel/assets/"):
                name = path.rsplit("/", 1)[-1]
                if name in ASSET_TYPES:
                    return self.reply(200, (ROOT / "assets" / name).read_bytes(), ASSET_TYPES[name])
                return self.reply(404, {"error": "Not found"})
            session = self.session()
            if path == "/api/status":
                if not session:
                    return self.reply(401, {"error": "Sign in required"})
                if hasattr(manager, "network"):
                    manager.network.observe_owner_origin(self.headers.get("Host"))
                return self.reply(200, {**manager.status(), "csrf": session["csrf"]})
            match = re.fullmatch(r"/api/proxies/([a-z0-9]{2,32})/bridge/(bundle|standalone|token)", path)
            if match:
                if not session:
                    return self.reply(401, {"error": "Sign in required"})
                proxy = manager.get(match[1])
                if not proxy:
                    return self.reply(404, {"error": "Proxy not found"})
                if match[2] == "token":
                    return self.reply(200, {"token": proxy.bridge["token"]})
                try:
                    if match[2] == "bundle":
                        return self.reply(200, bridge_bundle(proxy), "application/zip", filename="aral-bridge.zip")
                    return self.reply(200, standalone_worker(proxy), "text/javascript; charset=utf-8", filename="aral-worker-private.mjs")
                except PanelError as error:
                    return self.reply(400, {"error": str(error), "code": error.code})
                except Exception:
                    return self.reply(500, {"error": "Could not create bridge bundle"})
            return self.reply(404, {"error": "Not found"})

        def do_POST(self):
            if self.path.startswith("/_webbridge/"):
                return self.relay_web()
            self.connection.settimeout(10)
            origin = self.headers.get("Origin")
            if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                return self.reply(403, {"error": "Cross-origin request rejected"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    return self.reply(413, {"error": "Invalid request size"})
                data = json.loads(self.rfile.read(size))
                if not isinstance(data, dict):
                    raise ValueError()
            except (ValueError, OSError):
                return self.reply(400, {"error": "Invalid request"})
            path = urlsplit(self.path).path
            if path == "/api/setup":
                code, password = data.get("code"), data.get("password")
                if not isinstance(code, str) or len(code) > 128 or not isinstance(password, str):
                    return self.reply(400, {"error": "Invalid setup request"})
                try:
                    app.configure(code, password)
                    if hasattr(manager, "network"):
                        manager.network.observe_owner_origin(self.headers.get("Host"))
                    return self.reply(200, {"ok": True})
                except PanelError as error:
                    return self.reply(400, {"error": str(error), "code": error.code})
                except OSError:
                    return self.reply(500, {"error": "Could not save owner password"})
            if path == "/api/login":
                password = data.get("password", "")
                if not isinstance(password, str) or len(password) > 256:
                    return self.reply(400, {"error": "Invalid password"})
                token = app.login(password)
                if not token:
                    return self.reply(401, {"error": "Incorrect password or too many attempts. Wait one minute."})
                if hasattr(manager, "network"):
                    manager.network.observe_owner_origin(self.headers.get("Host"))
                secure = "; Secure" if os.environ.get("PANEL_PUBLIC_ORIGIN", "").startswith("https://") or panel_origin(self.headers.get("Host")) else ""
                return self.reply(200, {"ok": True}, cookie=f"panel_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800{secure}")
            session = self.session()
            if not session or not hmac.compare_digest(self.headers.get("X-CSRF-Token", ""), session["csrf"]):
                return self.reply(403, {"error": "Session expired; sign in again"})
            if path == "/api/proxies":
                try:
                    proxy = manager.create(data)
                    return self.reply(200, proxy.status())
                except PanelError as error:
                    return self.reply(400, {"error": str(error), "code": error.code})
                except Exception:
                    return self.reply(500, {"error": "Could not create the proxy"})
            match = re.fullmatch(r"/api/proxies/([a-z0-9]{2,32})", path)
            if match:
                try:
                    proxy = manager.update(match[1], data)
                    return self.reply(200, proxy.status())
                except PanelError as error:
                    return self.reply(400, {"error": str(error), "code": error.code})
                except Exception:
                    return self.reply(500, {"error": "Could not update the proxy"})
            if path == "/api/logout":
                with app.lock:
                    for token, value in list(app.sessions.items()):
                        if value is session:
                            del app.sessions[token]
                return self.reply(200, {"ok": True}, cookie="panel_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0")
            return self.reply(404, {"error": "Not found"})
    return Handler


def main():
    os.umask(0o077)
    manager = ProxyManager(os.environ.get("PANEL_DATA_DIR", "/data"))
    setup_code = None
    if os.environ.get("PANEL_PASSWORD_HASH") or os.environ.get("PANEL_PASSWORD"):
        try:
            password_hash = panel_password_hash()
        except PanelError as error:
            raise SystemExit(str(error))
    elif (manager.directory / "owner.json").exists():
        password_hash = json.loads((manager.directory / "owner.json").read_text())["password_hash"]
    else:
        password_hash = ""
        setup_path = manager.directory / "setup-code.json"
        if not setup_path.exists():
            write_private_json(setup_path, {"code": secrets.token_urlsafe(24)})
        setup_code = json.loads(setup_path.read_text())["code"]
        print("[setup] Open /panel/ and enter this one-time setup code: " + setup_code, flush=True)
    manager.resources.snapshot()
    manager.start_all()
    app = App(manager, password_hash, setup_code)
    port = int(os.environ.get("HTTP_PORT") or os.environ.get("PORT", "8080"))
    if any(p.port == port for p in manager.proxies):
        manager.stop_all()
        raise SystemExit("HTTP and MTProto ports must be different")
    server = ThreadingHTTPServer(("0.0.0.0", port), handler_for(app))
    def stop(*_):
        for proxy in manager.proxies:
            with proxy.lock:
                proxy.sample_usage(force=True)
        manager.stop_all()
        os._exit(0)
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    threading.Thread(target=manager.network.discover, daemon=True).start()
    print(f"[panel] listening on HTTP port {port}; admin authentication required", flush=True)
    while True:
        time.sleep(2)
        manager.resources.snapshot()
        manager.maintain()


if __name__ == "__main__":
    main()
