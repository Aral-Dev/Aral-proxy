"""Share one allocated TCP port between HTTP and several FakeTLS MTProto engines.

The hosting platform exposes exactly one public TCP port. HTTP requests are
recognized by their method prefix and routed to the panel. MTProto FakeTLS
connections wrap themselves in a standard TLS ClientHello whose SNI carries the
proxy's own masking domain, so the multi-router can dispatch each connection to
the engine instance that owns that domain. Connections without a known SNI fall
back to the default engine.
"""
import asyncio
import ipaddress
import json
import os
from pathlib import Path

HTTP_PREFIXES = (b"GET ", b"POST", b"HEAD", b"DELE", b"PUT ", b"OPTI", b"PATC")

MAX_CLIENT_HELLO = 5 + 16384 + 256  # record header plus one legal handshake record


def parse_client_hello_sni(data):
    """Extract the SNI hostname from a TLS ClientHello record.

    Returns (complete, host): complete is False when more bytes are needed to
    finish the record, otherwise host is the SNI domain (possibly ""). This
    function never raises on malformed input; it simply returns "".
    """
    try:
        if len(data) < 5:
            return (False, "") if data[:1] == b"\x16" else (True, "")
        if data[0] != 0x16:
            return True, ""
        record_len = int.from_bytes(data[3:5], "big")
        if len(data) < 5 + record_len:
            return (5 + record_len) > MAX_CLIENT_HELLO, ""
        if data[5] != 0x01:
            return True, ""
        handshake_len = int.from_bytes(data[6:9], "big")
        end = min(9 + handshake_len, 5 + record_len)
        pos = 9 + 2 + 32  # client version and random
        session_id = data[pos]
        pos += 1 + session_id
        cipher_len = int.from_bytes(data[pos:pos + 2], "big")
        pos += 2 + cipher_len
        compression_len = data[pos]
        pos += 1 + compression_len
        extensions_len = int.from_bytes(data[pos:pos + 2], "big")
        pos += 2
        extensions_end = min(pos + extensions_len, end)
        while pos + 4 <= extensions_end:
            extension_type = int.from_bytes(data[pos:pos + 2], "big")
            extension_len = int.from_bytes(data[pos + 2:pos + 4], "big")
            body = data[pos + 4:pos + 4 + extension_len]
            pos += 4 + extension_len
            if extension_type == 0 and len(body) >= 7:
                # server_name_list: list length, then entries of (type, length, name).
                list_len = int.from_bytes(body[0:2], "big")
                if list_len + 2 <= len(body) and body[2] == 0:
                    name_len = int.from_bytes(body[3:5], "big")
                    if name_len and 5 + name_len <= min(2 + list_len, len(body)):
                        return True, body[5:5 + name_len].decode("ascii", "ignore").strip().lower()
        return True, ""
    except (IndexError, ValueError):
        return True, ""


class PortRouter:
    def __init__(self, http_port, proxy_port, limit=128, proxy_protocol=False):
        self.http_port = http_port
        self.proxy_port = proxy_port
        self.limit = limit
        self.active = 0
        self.proxy_protocol = proxy_protocol

    def choose(self, prefix, extra=b""):
        return self.http_port if prefix in HTTP_PREFIXES else self.proxy_port

    def proxy_upstream(self, port):
        return port != self.http_port and self.proxy_protocol

    async def pipe(self, reader, writer):
        while True:
            chunk = await asyncio.wait_for(reader.read(65536), 300)
            if not chunk:
                if writer.can_write_eof():
                    writer.write_eof()
                    await writer.drain()
                return
            writer.write(chunk)
            await writer.drain()

    async def handle(self, reader, writer):
        if self.active >= self.limit:
            writer.close()
            return
        self.active += 1
        upstream = None
        tasks = []
        try:
            prefix = await asyncio.wait_for(reader.readexactly(4), 10)
            port = self.choose(prefix)
            upstream_reader, upstream = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 5)
            if self.proxy_upstream(port):
                peer, local = writer.get_extra_info("peername"), writer.get_extra_info("sockname")
                family = "TCP4" if ipaddress.ip_address(peer[0]).version == 4 else "TCP6"
                upstream.write(f"PROXY {family} {peer[0]} {local[0]} {peer[1]} {local[1]}\r\n".encode("ascii"))
            upstream.write(prefix)
            await upstream.drain()
            tasks = [asyncio.create_task(self.pipe(reader, upstream)), asyncio.create_task(self.pipe(upstream_reader, writer))]
            await asyncio.gather(*tasks)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            for connection in (upstream, writer):
                if connection:
                    connection.close()
            self.active -= 1


class MultiPortRouter(PortRouter):
    """Dispatch connections to the panel or to the engine owning the requested
    FakeTLS domain. The engine-to-domain map is published by the panel in a
    small JSON file; it is re-read only when the file changes."""

    def __init__(self, http_port, proxy_port, mapping_path, limit=256, proxy_protocol=True):
        super().__init__(http_port, proxy_port, limit=limit, proxy_protocol=proxy_protocol)
        self.mapping_path = Path(mapping_path)
        self.mapping_mtime = None
        self.mapping = {}
        self.mapping_default = proxy_port

    def refresh(self):
        try:
            mtime = os.stat(self.mapping_path).st_mtime_ns
        except OSError:
            mtime = None
        if mtime == self.mapping_mtime:
            return
        self.mapping_mtime = mtime
        try:
            data = json.loads(self.mapping_path.read_text())
            mapping = {}
            for entry in data.get("proxies", []):
                host = str(entry.get("host", "")).strip().lower()
                port = int(entry.get("port", 0))
                if host and 1 <= port <= 65535 and host not in mapping:
                    mapping[host] = port
            self.mapping = mapping
            default = int(data.get("default_port", 0))
            self.mapping_default = default if 1 <= default <= 65535 else self.proxy_port
        except (OSError, ValueError, TypeError):
            pass  # keep the last good map until the panel publishes a new one

    def choose(self, prefix, extra=b""):
        if prefix in HTTP_PREFIXES:
            return self.http_port
        self.refresh()
        if prefix and prefix[0] == 0x16:
            complete, host = parse_client_hello_sni(prefix + extra)
            if complete and host:
                port = self.mapping.get(host)
                if port:
                    return port
        return self.mapping_default

    async def handle(self, reader, writer):
        if self.active >= self.limit:
            writer.close()
            return
        self.active += 1
        upstream = None
        tasks = []
        buffered = b""
        try:
            prefix = await asyncio.wait_for(reader.readexactly(4), 10)
            buffered = prefix
            port = None
            if prefix not in HTTP_PREFIXES and prefix[0] == 0x16:
                # Read the complete ClientHello record so the SNI can be read.
                buffered += await asyncio.wait_for(reader.readexactly(1), 10)  # record length low byte
                record_len = int.from_bytes(buffered[3:5], "big")
                if 0 < record_len <= MAX_CLIENT_HELLO - 5:
                    buffered += await asyncio.wait_for(reader.readexactly(record_len), 10)
                port = self.choose(prefix, buffered[4:])
            if port is None:
                port = self.choose(prefix)
            upstream_reader, upstream = await asyncio.wait_for(asyncio.open_connection("127.0.0.1", port), 5)
            if self.proxy_upstream(port):
                peer, local = writer.get_extra_info("peername"), writer.get_extra_info("sockname")
                family = "TCP4" if ipaddress.ip_address(peer[0]).version == 4 else "TCP6"
                upstream.write(f"PROXY {family} {peer[0]} {local[0]} {peer[1]} {local[1]}\r\n".encode("ascii"))
            upstream.write(buffered)
            await upstream.drain()
            tasks = [asyncio.create_task(self.pipe(reader, upstream)), asyncio.create_task(self.pipe(upstream_reader, writer))]
            await asyncio.gather(*tasks)
        except (OSError, asyncio.TimeoutError, asyncio.IncompleteReadError):
            pass
        finally:
            for task in tasks:
                task.cancel()
            if tasks:
                await asyncio.gather(*tasks, return_exceptions=True)
            for connection in (upstream, writer):
                if connection:
                    connection.close()
            self.active -= 1
