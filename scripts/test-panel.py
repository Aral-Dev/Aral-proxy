import hashlib
from http.client import HTTPConnection
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import threading
import tomllib
import unittest
import zipfile
from unittest.mock import patch, Mock

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("panel_server", ROOT / "panel/server.py")
panel = importlib.util.module_from_spec(spec)
spec.loader.exec_module(panel)
SECRET = "ee" + "12" * 16 + b"www.cloudflare.com".hex()


def make_manager(directory, **env):
    environment = {"PANEL_DATA_DIR": directory, **env}
    with patch.dict(panel.os.environ, environment, clear=False):
        return panel.ProxyManager(directory)


class ProxyManagerTests(unittest.TestCase):
    def test_bootstrap_creates_default_proxy_and_persists_secret(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory}, clear=True):
            first = panel.ProxyManager(directory)
            self.assertEqual(len(first.proxies), 1)
            proxy = first.proxies[0]
            self.assertTrue(proxy.is_default)
            key, host = panel.decode_secret(proxy.secret)
            self.assertEqual(len(key), 16)
            self.assertEqual(host, "www.cloudflare.com")
            restored = panel.ProxyManager(directory)
            self.assertEqual(restored.proxies[0].secret, proxy.secret, "secret must be generated once")

    def test_legacy_single_proxy_data_migrates_and_keeps_links(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET}, clear=True):
            legacy = Path(directory)
            (legacy / "proxy-secret.json").write_text(json.dumps({"secret": SECRET}))
            (legacy / "sponsor.json").write_text(json.dumps({"enabled": False, "ad_tag": "", "channel": "mychannel"}))
            (legacy / "bridge.json").write_text(json.dumps({"worker_url": "https://old.example", "enabled": False, "public_ip": "", "token": "legacy-token"}))
            (legacy / "usage.json").write_text(json.dumps({"upload_bytes": 10, "download_bytes": 20, "since": 1700000000}))
            manager = panel.ProxyManager(directory)
            proxy = manager.proxies[0]
            self.assertEqual(proxy.id, "main")
            self.assertTrue(proxy.is_default)
            self.assertEqual(proxy.settings["channel"], "mychannel")
            self.assertEqual(proxy.bridge["token"], "legacy-token")
            self.assertEqual(proxy.usage["upload_bytes"], 10)
            self.assertEqual(proxy.tls_host, "www.cloudflare.com")
            # legacy files stay untouched so the previous version can still run
            self.assertTrue((legacy / "sponsor.json").exists())

    def test_create_validations_and_unique_ports(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory}, clear=True):
            manager = panel.ProxyManager(directory)
            with patch.object(manager, "_start_with_check"):
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "main proxy".title()})
                self.assertEqual(raised.exception.code, "name_taken")
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "X", "port": 80})
                self.assertEqual(raised.exception.code, "invalid_port")
                used_http = manager.http_port
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "X", "port": used_http})
                self.assertEqual(raised.exception.code, "port_taken")
                second = manager.create({"name": "Second", "port": 33221, "tls_host": "www.bing.com"})
                self.assertEqual(second.port, 33221)
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "Third", "port": 33221})
                self.assertEqual(raised.exception.code, "port_taken")
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "Third", "tls_host": "WWW.BING.COM"})
                self.assertEqual(raised.exception.code, "tls_host_taken")
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "Third", "tls_host": "not a domain"})
                self.assertEqual(raised.exception.code, "invalid_tls_host")
                third = manager.create({"name": "Third"})
            self.assertNotIn(third.port, {manager.http_port, second.port})
            self.assertNotEqual(third.tls_host, second.tls_host)
            router = json.loads((Path(directory) / "router.json").read_text())
            hosts = {entry["host"]: entry["port"] for entry in router["proxies"]}
            self.assertEqual(hosts["www.bing.com"], 33221)
            self.assertEqual(router["default_port"], manager.proxies[0].port)

    def test_delete_updates_router_and_disk(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory}, clear=True):
            manager = panel.ProxyManager(directory)
            with patch.object(manager, "_start_with_check"):
                created = manager.create({"name": "Temp", "port": 33230})
            manager.delete(created.id)
            self.assertEqual(len(manager.proxies), 1)
            self.assertFalse((Path(directory) / "proxies" / created.id).exists())
            router = json.loads((Path(directory) / "router.json").read_text())
            self.assertEqual(len(router["proxies"]), 1)

    def test_max_proxies_limit_and_memory_guard(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "PANEL_MAX_PROXIES": "2"}, clear=True):
            manager = panel.ProxyManager(directory)
            with patch.object(manager, "_start_with_check"):
                manager.create({"name": "B"})
                with self.assertRaises(panel.PanelError) as raised:
                    manager.create({"name": "C"})
            self.assertEqual(raised.exception.code, "limit_reached")

    def test_update_rename_and_status_shape(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory}, clear=True):
            manager = panel.ProxyManager(directory)
            status = manager.status()
            self.assertEqual(status["server"]["engine"], "Telemt")
            self.assertIn("resources", status["server"])
            entry = status["proxies"][0]
            for field in ("id", "name", "enabled", "running", "port", "tls_host", "usage", "settings", "bridge", "tg_link"):
                self.assertIn(field, entry)
            manager.update("main", {"name": "Renamed"})
            self.assertEqual(manager.get("main").name, "Renamed")
            with self.assertRaises(panel.PanelError) as raised:
                manager.update("missing", {"name": "Nope"})
            self.assertEqual(raised.exception.code, "not_found")


class FakeProxy:
    bridge = {"enabled": True, "token": "test-token", "worker_url": "https://worker.example"}

    def hosting_origin(self):
        return "https://demo.apps.bot-hosting.cloud"

    def ready(self):
        return True

    def status(self):
        return {"running": True, "secret": "private-example"}

    def apply(self, data):
        panel.validate_settings(data)


class BridgeTests(unittest.TestCase):
    def test_bridge_validation_and_private_bundle(self):
        for url in ("http://worker.example", "https://worker.example/path", "https://user:pass@worker.example", "https://worker.example?token=x"):
            with self.subTest(url=url), self.assertRaises(panel.PanelError):
                panel.validate_bridge({"worker_url": url})
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET, "PUBLIC_HOST": "node.bot-hosting.cloud", "PUBLIC_PORT": "25745"}, clear=True):
            manager = panel.ProxyManager(directory)
            proxy = manager.proxies[0]
            original_token = proxy.bridge["token"]
            with patch.object(proxy, "start") as start, patch.object(proxy, "stop"), patch.object(proxy, "ready", return_value=True):
                manager.update(proxy.id, {"bridge": {"worker_url": "https://bridge.example", "enabled": False}})
                start.assert_not_called()  # staying disabled must not restart the engine
            restored = panel.ProxyManager(directory).proxies[0]
            self.assertEqual(restored.bridge["token"], original_token)
            self.assertEqual(restored.bridge["worker_url"], "https://bridge.example")
            with zipfile.ZipFile(io.BytesIO(panel.bridge_bundle(restored))) as archive:
                config = json.loads(archive.read("bridge-config.json"))
                worker = json.loads(archive.read("wrangler.jsonc"))
                self.assertEqual(config["token"], original_token)
                self.assertEqual(config["worker_url"], "https://bridge.example")
                self.assertIn("UPSTREAM_ORIGIN", worker["vars"])
                self.assertRegex(worker["name"], r"^aral-proxy-tg-[a-f0-9]{8}$")
                self.assertEqual(worker["name"], proxy.worker_name())
                self.assertNotIn("helper.mjs", archive.namelist())
                self.assertNotIn(original_token, archive.read("worker.mjs").decode())
                self.assertNotIn("PANEL_PASSWORD_HASH", archive.read("bridge-config.json").decode())

    def test_native_web_configuration_and_link(self):
        bridge = {"enabled": True, "worker_url": "https://worker.example", "public_ip": "1.1.1.1"}
        data = tomllib.loads(panel.telemt_config(SECRET, {"enabled": False, "ad_tag": ""}, 3128, bridge, metrics_port=9090, api_port=9091, web_port=18080, routed=True))
        self.assertFalse(data["general"]["use_middle_proxy"])
        self.assertEqual(data["server"]["listeners"][1]["ip"], "127.0.0.1")
        self.assertEqual(data["web"]["carrier"], "https")
        self.assertEqual(data["web"]["vhosts"][0]["profiles"][0]["secret_mode"], "dd")
        self.assertEqual(data["server"]["metrics_listen"], "127.0.0.1:9090")
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET}, clear=True):
            manager = panel.ProxyManager(directory)
            proxy = manager.proxies[0]
            proxy.bridge.update(bridge)
            link = proxy.status()["bridge"]["tg_link"]
            self.assertEqual(link, "tg://webproxy?server=worker.example&secret=dd" + "12" * 16)

    def test_failed_web_enable_rolls_back(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET}, clear=True):
            proxy = panel.ProxyManager(directory).proxies[0]
            proxy.process = Mock()
            proxy.process.poll.return_value = 1
            with patch.object(proxy, "stop"), patch.object(proxy, "start"), patch.object(proxy, "ready", return_value=False):
                with self.assertRaises(panel.PanelError):
                    proxy.apply_bridge({"enabled": True, "worker_url": "https://worker.example", "public_ip": "1.1.1.1"})
            self.assertFalse(proxy.bridge["enabled"])
            self.assertFalse(panel.ProxyManager(directory).proxies[0].bridge["enabled"])

    def test_secret_preserved(self):
        key, host = panel.decode_secret(SECRET)
        self.assertEqual(key.hex(), "12" * 16)
        self.assertEqual(host, "www.cloudflare.com")

    def test_telemt_config_per_proxy_ports(self):
        data = tomllib.loads(panel.telemt_config(SECRET, {"ad_tag": "ab" * 16}, 32128, metrics_port=9101, api_port=9201, web_port=18081, routed=True))
        self.assertTrue(data["general"]["use_middle_proxy"])
        self.assertEqual(data["general"]["ad_tag"], "ab" * 16)
        self.assertEqual(data["access"]["users"]["owner"], "12" * 16)
        self.assertFalse(data["access"]["ignore_time_skew"])
        self.assertEqual(data["server"]["api"]["listen"], "127.0.0.1:9201")
        self.assertEqual(data["server"]["metrics_listen"], "127.0.0.1:9101")
        self.assertEqual(data["server"]["port"], 32128)
        self.assertTrue(data["server"]["listeners"][0]["proxy_protocol"])

    def test_settings_validation(self):
        for value in ({"enabled": True}, {"enabled": "true"}, {"channel": '<script>'}, {"ad_tag": '"\nmalicious'}, []):
            with self.subTest(value=value), self.assertRaises(panel.PanelError):
                panel.validate_settings(value)
        self.assertEqual(panel.validate_settings({"channel": "https://t.me/mychannel"})["channel"], "mychannel")

    def test_settings_switch_restores_previous_on_failure(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET}, clear=True):
            proxy = panel.ProxyManager(directory).proxies[0]
            proxy.process = Mock()
            proxy.process.poll.return_value = 1
            with patch.object(proxy, "stop"), patch.object(proxy, "start") as start, patch.object(proxy, "ready", return_value=False):
                with self.assertRaises(panel.PanelError):
                    proxy.apply({"enabled": True, "ad_tag": "ab" * 16})
                self.assertEqual(start.call_count, 2)
            self.assertFalse(proxy.settings["enabled"])


class ResourceTests(unittest.TestCase):
    def test_deployment_disk_usage_uses_own_files_and_configured_quota(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(panel.os.environ, {"PANEL_STORAGE_ROOT": folder, "PANEL_STORAGE_LIMIT_MB": "1"}):
            (Path(folder) / "data.bin").write_bytes(b"x" * 100)
            result = panel.Resources(folder).snapshot()
            self.assertEqual(result["disk_scope"], "deployment")
            self.assertEqual(result["disk_used"], 100)
            self.assertEqual(result["disk_total"], 1024 * 1024)

    def test_container_limits_cpu_interval_and_disk(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "cpu.max").write_text("50000 100000")
            (root / "cpu.stat").write_text("usage_usec 1000000")
            (root / "memory.current").write_text("256")
            (root / "memory.max").write_text("1024")
            reader = panel.Resources(folder, root)
            with patch.object(panel.time, "monotonic", return_value=10):
                first = reader.snapshot()
            self.assertIsNone(first["cpu_percent"])
            self.assertEqual(first["cpu_cores"], 0.5)
            self.assertEqual(first["memory_percent"], 25)
            self.assertGreater(first["disk_total"], 0)
            (root / "cpu.stat").write_text("usage_usec 1500000")
            with patch.object(panel.time, "monotonic", return_value=12):
                self.assertEqual(reader.snapshot()["cpu_percent"], 50)

    def test_missing_container_counters_do_not_show_host_memory(self):
        with tempfile.TemporaryDirectory() as folder:
            reader = panel.Resources(folder, Path(folder) / "missing")
            data = reader.snapshot()
            self.assertIsNone(data["cpu_percent"])
            self.assertIsNone(data["memory_percent"])
            self.assertIsNone(data["memory_used"])
            self.assertGreater(data["disk_total"], 0)


class UsageTests(unittest.TestCase):
    def test_telemt_counts_are_not_confused_with_connections_or_decoys(self):
        text = """# HELP telemt_user_connections_current Per-user active connections
telemt_user_connections_current{user="owner"} 9
telemt_user_unique_ips_current{user="owner"} 3
telemt_user_octets_from_client_total{user="owner"} 100
telemt_user_octets_to_client_total{user="owner"} 250
telemt_user_connections_total{user="owner"} 3000
unrelated_bytes_total 999999
"""
        result = panel.parse_usage_metrics(text)
        self.assertEqual(result, {"connections": 9, "users": 3, "upload": 100, "download": 250, "valid": True})
        self.assertFalse(panel.parse_usage_metrics("not metrics")["valid"])
        self.assertEqual(panel.parse_usage_metrics("# HELP telemt_user_connections_current active")["connections"], 0)

    def test_usage_deltas_restart_persistence_and_unavailable_metrics(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(panel.os.environ, {"PANEL_DATA_DIR": directory, "SECRET": SECRET}, clear=True):
            proxy = panel.ProxyManager(directory).proxies[0]
            proxy.process = Mock()
            proxy.process.poll.return_value = None
            with patch.object(panel.http.client, "HTTPConnection") as factory:
                response = factory.return_value.getresponse.return_value
                response.status = 200
                def metrics(up, down):
                    return ('# HELP telemt_user_connections_current Active connections\ntelemt_user_octets_from_client_total{user="owner"} ' + str(up) + '\ntelemt_user_octets_to_client_total{user="owner"} ' + str(down)).encode()
                response.read.return_value = metrics(100, 200)
                proxy.sample_usage(force=True)
                proxy.sample_usage(force=True)
                self.assertEqual(proxy.usage["upload_bytes"], 100)
                response.read.return_value = metrics(125, 240)
                proxy.sample_usage(force=True)
                self.assertEqual(proxy.usage["download_bytes"], 240)
                response.status = 503
                proxy.sample_usage(force=True)
                self.assertFalse(proxy.live_usage["available"])
                restored = panel.ProxyManager(directory).proxies[0]
                self.assertEqual(restored.usage["upload_bytes"], 125)
                response.status = 200
                response.read.return_value = metrics(10, 30)
                restored.process = Mock()
                restored.process.poll.return_value = None
                restored.sample_usage(force=True)
                self.assertEqual(restored.usage["upload_bytes"], 135)
                self.assertEqual(restored.usage["download_bytes"], 270)


class HTTPTests(unittest.TestCase):
    def setUp(self):
        self.manager = Mock()
        self.manager.network = Mock()
        self.manager.network.host = ""
        self.manager.proxies = []
        self.manager.status.return_value = {"server": {"engine": "Telemt"}, "proxies": []}
        self.manager.find_by_bridge_token.return_value = None
        self.app = panel.App(self.manager, hashlib.sha256(b"test-password").hexdigest())
        self.server = panel.ThreadingHTTPServer(("127.0.0.1", 0), panel.handler_for(self.app))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()

    def request(self, path, data=None, headers=None, method=None):
        connection = HTTPConnection("127.0.0.1", self.port, timeout=3)
        h = headers or {}
        connection.request(method or ("POST" if data is not None else "GET"), path, body=json.dumps(data) if data is not None else None, headers=h)
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_private_status_and_public_health(self):
        self.assertEqual(self.request("/api/status")[0], 401)
        self.assertEqual(self.request("/api/proxies/main/bridge/bundle")[0], 401)
        self.assertEqual(self.request("/api/proxies/main/bridge/standalone")[0], 401)
        self.assertEqual(self.request("/api/proxies/main/bridge/token")[0], 401)
        self.assertEqual(self.request("/health")[0], 200)
        self.assertNotIn(b"private-example", self.request("/")[2])
        self.assertEqual(self.request("/../server.py")[0], 404)

    def test_first_visit_password_setup_requires_code_and_cannot_reset_owner(self):
        with tempfile.TemporaryDirectory() as directory:
            self.app.manager = make_manager(directory)
            self.app.password_hash = ""
            self.app.setup_code = "synthetic-setup-code"
            code, _, body = self.request("/api/setup/status")
            self.assertEqual(code, 200)
            self.assertTrue(json.loads(body)["required"])
            self.assertNotIn(b"synthetic-setup-code", body)
            self.assertEqual(self.request("/api/setup", {"code": "wrong", "password": "Eight123"})[0], 400)
            self.assertEqual(self.request("/api/setup", {"code": "synthetic-setup-code", "password": "short"})[0], 400)
            self.assertFalse((Path(directory) / "owner.json").exists())
            self.assertEqual(self.request("/api/setup", {"code": "synthetic-setup-code", "password": "Eight123"}, {"Origin": "https://evil.example"})[0], 403)
            self.assertEqual(self.request("/api/setup", {"code": "synthetic-setup-code", "password": "Eight123"})[0], 200)
            stored = json.loads((Path(directory) / "owner.json").read_text())["password_hash"]
            self.assertTrue(stored.startswith("pbkdf2_sha256$"))
            self.assertNotIn("Eight123", stored)
            self.assertFalse(json.loads(self.request("/api/setup/status")[2])["required"])
            self.assertEqual(self.request("/api/setup", {"code": "synthetic-setup-code", "password": "changed123"})[0], 400)
            self.assertEqual(self.request("/api/login", {"password": "Eight123"})[0], 200)

    def test_login_csrf_logout_and_proxy_api(self):
        self.assertEqual(self.request("/api/login", {"password": "wrong"})[0], 401)
        code, headers, _ = self.request("/api/login", {"password": "test-password"})
        self.assertEqual(code, 200)
        self.assertIn("HttpOnly", headers["Set-Cookie"])
        cookie = headers["Set-Cookie"].split(";", 1)[0]
        code, _, body = self.request("/api/status", headers={"Cookie": cookie})
        self.assertEqual(code, 200)
        csrf = json.loads(body)["csrf"]
        self.assertEqual(self.request("/api/proxies", {"name": "New"}, {"Cookie": cookie})[0], 403)
        headers = {"Cookie": cookie, "X-CSRF-Token": csrf}
        self.manager.create.return_value = FakeProxy()
        code, _, _ = self.request("/api/proxies", {"name": "New"}, headers)
        self.assertEqual(code, 200)
        self.manager.create.assert_called_once_with({"name": "New"})
        self.assertEqual(self.request("/api/proxies/main", {"name": "Renamed"}, headers)[0], 200)
        self.manager.update.assert_called_once_with("main", {"name": "Renamed"})
        self.assertEqual(self.request("/api/proxies/main", None, headers, method="DELETE")[0], 200)
        self.manager.delete.assert_called_once_with("main")
        self.assertEqual(self.request("/api/logout", {}, headers)[0], 200)
        self.assertEqual(self.request("/api/status", headers={"Cookie": cookie})[0], 401)

    def test_cross_origin_and_rate_limit(self):
        self.assertEqual(self.request("/api/login", {"password": "test-password"}, {"Origin": "https://evil.example"})[0], 403)
        for _ in range(10):
            self.app.login("wrong")
        self.assertIsNone(self.app.login("test-password"))

    def test_secure_production_cookie(self):
        with patch.dict(panel.os.environ, {"PANEL_PUBLIC_ORIGIN": "https://example.apps.bot-hosting.cloud"}):
            _, headers, _ = self.request("/api/login", {"password": "test-password"})
            self.assertIn("; Secure", headers["Set-Cookie"])
        with patch.dict(panel.os.environ, {"PANEL_PUBLIC_ORIGIN": "https://my-app.apps.bot-hosting.cloud"}):
            _, headers, _ = self.request("/api/login", {"password": "test-password"})
            self.assertIn("; Secure", headers["Set-Cookie"])

    def test_visual_assets_are_served_without_exposing_other_files(self):
        self.assertEqual(self.request("/panel/aral.css")[0], 200)
        code, headers, body = self.request("/panel/assets/dark-logo.png")
        self.assertEqual(code, 200)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertTrue(body.startswith(b"\x89PNG"))
        self.assertEqual(self.request("/panel/assets/../server.py")[0], 404)
        self.assertEqual(self.request("/panel/NOTICE.md")[0], 404)
        self.assertEqual(self.request("/panel/assets/secret.png")[0], 404)

    def test_no_youtube_endpoints_remain(self):
        cookie = self.request("/api/login", {"password": "test-password"})[1]["Set-Cookie"].split(";", 1)[0]
        self.assertEqual(self.request("/api/latest-video", headers={"Cookie": cookie})[0], 404)
        self.assertEqual(self.request("/api/latest-video/thumbnail", headers={"Cookie": cookie})[0], 404)
        self.assertNotIn(b"youtube", self.request("/")[2].lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
