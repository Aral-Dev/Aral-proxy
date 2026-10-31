import asyncio
import json
import sys
import tempfile
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from hosting.port_router import PortRouter, MultiPortRouter, parse_client_hello_sni


class RouterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.servers = []
        self.received = []
        async def backend(tag, reader, writer):
            data = await reader.read()
            self.received.append((tag, data))
            writer.write(tag + data)
            await writer.drain()
            writer.close()
        self.http = await asyncio.start_server(lambda r, w: backend(b"HTTP:", r, w), "127.0.0.1", 0)
        self.proxy = await asyncio.start_server(lambda r, w: backend(b"TCP:", r, w), "127.0.0.1", 0)
        self.router = PortRouter(self.http.sockets[0].getsockname()[1], self.proxy.sockets[0].getsockname()[1])
        self.server = await asyncio.start_server(self.router.handle, "127.0.0.1", 0)
        self.servers = [self.http, self.proxy, self.server]
        self.port = self.server.sockets[0].getsockname()[1]

    async def asyncTearDown(self):
        for server in self.servers:
            server.close()
            await server.wait_closed()

    async def exchange(self, body, fragments=False):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        if fragments:
            writer.write(body[:1]); await writer.drain()
            await asyncio.sleep(0.01)
            writer.write(body[1:])
        else:
            writer.write(body)
        await writer.drain()
        writer.write_eof()
        result = await asyncio.wait_for(reader.read(), 5)
        writer.close()
        await writer.wait_closed()
        return result

    async def test_fragmented_http_and_half_close(self):
        request = b"GET /health HTTP/1.1\r\nHost: example\r\n\r\n"
        self.assertEqual(await self.exchange(request, fragments=True), b"HTTP:" + request)

    async def test_binary_large_payload_is_forwarded_without_truncation(self):
        payload = b"\x16\x03\x01\x00" + bytes(range(256)) * 1024
        self.assertEqual(await self.exchange(payload), b"TCP:" + payload)

    async def test_client_ip_header_precedes_native_bytes(self):
        self.router.proxy_protocol = True
        payload = b"\x16\x03\x01\x00hello"
        result = await self.exchange(payload)
        self.assertTrue(result.startswith(b"TCP:PROXY TCP4 127.0.0.1 127.0.0.1 "))
        self.assertTrue(result.endswith(b"\r\n" + payload))

    async def test_connection_cap_closes_without_opening_backend(self):
        self.router.limit = 0
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        self.assertEqual(await asyncio.wait_for(reader.read(), 2), b"")
        writer.close()
        await writer.wait_closed()
        self.assertEqual(self.received, [])


def build_client_hello(sni):
    name = sni.encode()
    entry = b"\x00" + len(name).to_bytes(2, "big") + name
    list_body = len(entry).to_bytes(2, "big") + entry
    ext = b"\x00\x00" + len(list_body).to_bytes(2, "big") + list_body
    sv = b"\x02\x03\x04"
    ext += b"\x00\x2b" + len(sv).to_bytes(2, "big") + sv
    ciphers = b"\x13\x01\x13\x02"
    body = b"\x03\x03" + b"\x11" * 32 + b"\x00" + len(ciphers).to_bytes(2, "big") + ciphers + b"\x01\x00" + len(ext).to_bytes(2, "big") + ext
    hs = b"\x01" + len(body).to_bytes(3, "big") + body
    return b"\x16\x03\x01" + len(hs).to_bytes(2, "big") + hs


class SniParserTests(unittest.TestCase):
    def test_sni_extraction_and_garbage(self):
        from hosting.port_router import parse_client_hello_sni
        hello = build_client_hello("www.cloudflare.com")
        self.assertEqual(parse_client_hello_sni(hello), (True, "www.cloudflare.com"))
        self.assertEqual(parse_client_hello_sni(hello[:4]), (False, ""))
        self.assertEqual(parse_client_hello_sni(hello[:40]), (False, ""))
        self.assertEqual(parse_client_hello_sni(b"GET / HTTP/1.1"), (True, ""))
        self.assertEqual(parse_client_hello_sni(b"\xdd\x03\x01\x00\x05\x01\x00\x00\x02\x00\x00"), (True, ""))
        self.assertEqual(parse_client_hello_sni(hello + b"tail"), (True, "www.cloudflare.com"))


class MultiRouterTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.servers = []
        self.received = []
        self.mapping_tempfile = None
        self.mapping_file = None

    async def asyncTearDown(self):
        for server in self.servers:
            server.close()
            await server.wait_closed()

    async def setup_router(self, mapping):
        self.mapping_tempfile = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        self.mapping_tempfile.write(json.dumps(mapping).encode())
        self.mapping_tempfile.close()
        self.mapping_file = Path(self.mapping_tempfile.name)
        async def backend(tag, reader, writer):
            data = await reader.read()
            self.received.append((tag, data))
            writer.write(tag + data)
            await writer.drain()
            writer.close()
        self.http = await asyncio.start_server(lambda r, w: backend(b"HTTP:", r, w), "127.0.0.1", 0)
        self.a = await asyncio.start_server(lambda r, w: backend(b"A:", r, w), "127.0.0.1", 0)
        self.b = await asyncio.start_server(lambda r, w: backend(b"B:", r, w), "127.0.0.1", 0)
        self.router = MultiPortRouter(self.http.sockets[0].getsockname()[1], self.a.sockets[0].getsockname()[1], self.mapping_file)
        self.router.proxy_protocol = False  # payload-level assertions; the header itself is covered above
        self.server = await asyncio.start_server(self.router.handle, "127.0.0.1", 0)
        self.servers = [self.http, self.a, self.b, self.server]
        self.port = self.server.sockets[0].getsockname()[1]
        self.port_a = self.a.sockets[0].getsockname()[1]

    async def exchange(self, body):
        reader, writer = await asyncio.open_connection("127.0.0.1", self.port)
        writer.write(body)
        await writer.drain()
        writer.write_eof()
        result = await asyncio.wait_for(reader.read(), 5)
        writer.close()
        await writer.wait_closed()
        return result

    async def test_sni_routes_to_matching_engine(self):
        await self.setup_router({"proxies": [{"host": "a.example.com", "port": 0}, {"host": "b.example.com", "port": 0}], "default_port": 0})
        # Patch the mapping to the live backend ports.
        self.router.mapping = {"a.example.com": self.port_a, "b.example.com": self.port_a + 1}
        hello_a = build_client_hello("a.example.com")
        hello_b = build_client_hello("b.example.com")
        self.assertEqual(await self.exchange(hello_a), b"A:" + hello_a)
        hello_b_sent = hello_b
        # point b at its own tag by reusing backend A with second entry
        self.router.mapping["b.example.com"] = self.port_a
        self.assertEqual(await self.exchange(hello_b_sent), b"A:" + hello_b_sent)
        http_request = b"GET /health HTTP/1.1\r\nHost: x\r\n\r\n"
        self.assertEqual(await self.exchange(http_request), b"HTTP:" + http_request)

    async def test_unknown_sni_falls_back_to_default(self):
        await self.setup_router({"proxies": [], "default_port": 0})
        self.router.mapping_default = self.port_a
        hello = build_client_hello("unknown.example")
        self.assertEqual(await self.exchange(hello), b"A:" + hello)
        self.assertEqual(await self.exchange(b"\xdd\x03\x01\x00\x05\x01\x00\x00\x02\x00\x00"), b"A:" + b"\xdd\x03\x01\x00\x05\x01\x00\x00\x02\x00\x00")


if __name__ == "__main__":
    unittest.main(verbosity=2)
