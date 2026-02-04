#!/usr/bin/env python3
"""Degenerus Protocol event indexer + state reconstruction.

Usage:
  python event_indexer.py --config config.json run
  python event_indexer.py --config config.json backfill --from-block 0
  python event_indexer.py --config config.json state --block 12345
  python event_indexer.py --config config.json events --contract DegenerusGame --name JackpotPaid

Notes:
- ABI loading supports Hardhat artifacts (artifact JSON with an `abi` field) or raw ABI JSON arrays.
- State reconstruction is best-effort and intended to be extended by adding more event handlers.
"""

import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
from collections import defaultdict
from typing import Any, Dict, Iterable, List, Optional, Tuple

import sqlite3

from hexbytes import HexBytes
from web3 import Web3
from web3._utils.events import get_event_data, event_abi_to_log_topic

try:
    import websockets
except Exception:  # pragma: no cover - import error will show at runtime
    websockets = None


ZERO_ADDRESS = "0x0000000000000000000000000000000000000000"


def _log(msg: str) -> None:
    ts = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())
    sys.stderr.write(f"[{ts} UTC] {msg}\n")
    sys.stderr.flush()


def _json_default(obj: Any) -> Any:
    if isinstance(obj, HexBytes):
        return obj.hex()
    if isinstance(obj, (bytes, bytearray)):
        return "0x" + obj.hex()
    if isinstance(obj, set):
        return list(obj)
    return str(obj)


def _json_dumps(obj: Any) -> str:
    return json.dumps(obj, default=_json_default, ensure_ascii=True)


def _load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _to_checksum(addr: str) -> str:
    return Web3.to_checksum_address(addr)


def _db_addr(addr: str) -> str:
    return addr.lower()


def _parse_int(value: Any) -> int:
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        if value.startswith("0x"):
            return int(value, 16)
        return int(value)
    return int(value)


def _normalize_log(log: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(log)
    if isinstance(out.get("transactionHash"), str):
        out["transactionHash"] = HexBytes(out["transactionHash"])
    if isinstance(out.get("data"), str):
        out["data"] = HexBytes(out["data"])
    if isinstance(out.get("topics"), list):
        out["topics"] = [HexBytes(t) if isinstance(t, str) else t for t in out["topics"]]
    for key in ("blockNumber", "transactionIndex", "logIndex"):
        if key in out:
            out[key] = _parse_int(out[key])
    if "address" in out and isinstance(out["address"], str):
        out["address"] = _to_checksum(out["address"])
    return out


class EventIndexer:
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.rpc_ws = config.get("rpc_ws")
        self.rpc_http = config.get("rpc_http")
        self.db_path = config.get("db_path", "./events.db")
        self.abi_dir = config.get("abi_dir", "./abis")
        self.start_block = int(config.get("start_block", 0))
        self.reconnect_delay = int(config.get("reconnect_delay", 5))
        self.batch_size = int(config.get("batch_size", 1000))
        self.health_check_interval = int(config.get("health_check_interval", 30))
        self.health_check_threshold = int(config.get("health_check_threshold", 3))

        self.w3_http = Web3(Web3.HTTPProvider(self.rpc_http)) if self.rpc_http else None
        self.contracts: Dict[str, Dict[str, Any]] = {}
        self.contract_addresses: List[str] = []
        self.topic_to_abi: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.event_abis: Dict[str, List[Dict[str, Any]]] = {}

        self.conn: Optional[sqlite3.Connection] = None
        self.db_lock = asyncio.Lock()

        self.last_processed_block: Optional[int] = None
        self.last_processed_timestamp: Optional[int] = None
        self._block_ts_cache: Dict[int, int] = {}
        self._ws_id = 0

    async def start(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets package not available")
        await self.init_db()
        await self.load_contracts()
        await self.backfill_missed_blocks()
        await asyncio.gather(
            self.subscribe_to_events(),
            self._health_check_loop(),
        )

    async def init_db(self) -> None:
        self.conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        cur = self.conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                block_number INTEGER NOT NULL,
                block_timestamp INTEGER,
                transaction_hash TEXT NOT NULL,
                transaction_index INTEGER,
                log_index INTEGER NOT NULL,
                contract_address TEXT NOT NULL,
                event_name TEXT NOT NULL,
                event_signature TEXT,
                raw_data TEXT,
                decoded_args TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(transaction_hash, log_index)
            )
            """
        )
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_block ON events(block_number)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_contract ON events(contract_address)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_events_name ON events(event_name)")
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_events_contract_block ON events(contract_address, block_number)"
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS sync_state (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                last_processed_block INTEGER NOT NULL,
                last_processed_timestamp INTEGER,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS contracts (
                address TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                abi_hash TEXT,
                deployed_block INTEGER
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS event_indexed_args (
                transaction_hash TEXT NOT NULL,
                log_index INTEGER NOT NULL,
                arg_name TEXT NOT NULL,
                arg_value TEXT,
                contract_address TEXT,
                event_name TEXT,
                block_number INTEGER,
                PRIMARY KEY (transaction_hash, log_index, arg_name)
            )
            """
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_indexed_args_name_value ON event_indexed_args(arg_name, arg_value)"
        )
        cur.execute(
            "CREATE INDEX IF NOT EXISTS idx_event_indexed_args_contract ON event_indexed_args(contract_address)"
        )
        cur.execute("SELECT last_processed_block, last_processed_timestamp FROM sync_state WHERE id = 1")
        row = cur.fetchone()
        if row is None:
            initial_block = max(self.start_block - 1, 0)
            cur.execute(
                "INSERT INTO sync_state (id, last_processed_block, last_processed_timestamp) VALUES (1, ?, ?)",
                (initial_block, None),
            )
            self.last_processed_block = initial_block
            self.last_processed_timestamp = None
        else:
            self.last_processed_block = int(row["last_processed_block"])
            self.last_processed_timestamp = row["last_processed_timestamp"]
        self.conn.commit()

    async def load_contracts(self) -> None:
        contracts_cfg = self.config.get("contracts", {})
        if not contracts_cfg:
            raise ValueError("config.contracts is empty")
        if not self.w3_http:
            raise RuntimeError("rpc_http is required for ABI decoding and backfills")

        for name, entry in contracts_cfg.items():
            if isinstance(entry, dict):
                address = entry.get("address")
                deployed_block = entry.get("deployed_block")
                abi_source = entry.get("abi")
            else:
                address = entry
                deployed_block = None
                abi_source = None

            if not address:
                raise ValueError(f"Missing address for contract {name}")
            checksum = _to_checksum(address)
            abi = self._load_abi_for_contract(name, abi_source)
            abi_hash = _sha256_text(_json_dumps(abi)) if abi else None

            self.contracts[checksum] = {
                "name": name,
                "address": checksum,
                "abi": abi,
                "abi_hash": abi_hash,
                "deployed_block": deployed_block,
            }

        self.contract_addresses = sorted(self.contracts.keys())
        self._build_event_maps()
        await self._persist_contracts()

    def _load_abi_for_contract(self, name: str, abi_source: Optional[Any]) -> Optional[List[Dict[str, Any]]]:
        if isinstance(abi_source, list):
            return abi_source
        if isinstance(abi_source, str):
            abi_path = abi_source
            if os.path.isdir(abi_path):
                abi_path = self._find_abi_file(name, abi_path)
            if abi_path and os.path.exists(abi_path):
                return self._extract_abi(_load_json(abi_path))
            raise FileNotFoundError(f"ABI path not found for {name}: {abi_source}")

        abi_path = self._find_abi_file(name, self.abi_dir)
        if abi_path:
            return self._extract_abi(_load_json(abi_path))
        _log(f"WARN: ABI not found for {name} (searched in {self.abi_dir})")
        return None

    @staticmethod
    def _extract_abi(abi_json: Any) -> Optional[List[Dict[str, Any]]]:
        if isinstance(abi_json, list):
            return abi_json
        if isinstance(abi_json, dict) and "abi" in abi_json:
            return abi_json.get("abi")
        return None

    @staticmethod
    def _find_abi_file(contract_name: str, abi_dir: str) -> Optional[str]:
        if not abi_dir or not os.path.exists(abi_dir):
            return None
        direct = os.path.join(abi_dir, f"{contract_name}.json")
        if os.path.exists(direct):
            return direct
        direct_alt = os.path.join(abi_dir, f"{contract_name}.abi.json")
        if os.path.exists(direct_alt):
            return direct_alt

        matches: List[str] = []
        for root, _dirs, files in os.walk(abi_dir):
            for filename in files:
                if filename == f"{contract_name}.json":
                    matches.append(os.path.join(root, filename))
        if matches:
            return matches[0]
        return None

    def _build_event_maps(self) -> None:
        self.topic_to_abi.clear()
        self.event_abis.clear()
        for address, meta in self.contracts.items():
            abi = meta.get("abi") or []
            event_abis = [item for item in abi if isinstance(item, dict) and item.get("type") == "event"]
            self.event_abis[address] = event_abis
            topic_map: Dict[str, Dict[str, Any]] = {}
            for event_abi in event_abis:
                if event_abi.get("anonymous"):
                    continue
                topic = event_abi_to_log_topic(event_abi).hex()
                topic_map[topic] = event_abi
            self.topic_to_abi[address] = topic_map

    async def _persist_contracts(self) -> None:
        if not self.conn:
            raise RuntimeError("DB not initialized")
        async with self.db_lock:
            cur = self.conn.cursor()
            for address, meta in self.contracts.items():
                cur.execute(
                    "INSERT OR REPLACE INTO contracts (address, name, abi_hash, deployed_block) VALUES (?, ?, ?, ?)",
                    (
                        _db_addr(address),
                        meta.get("name"),
                        meta.get("abi_hash"),
                        meta.get("deployed_block"),
                    ),
                )
            self.conn.commit()

    async def backfill_missed_blocks(self) -> None:
        if not self.w3_http:
            raise RuntimeError("rpc_http is required for backfills")
        latest = self.w3_http.eth.block_number
        last = self.last_processed_block if self.last_processed_block is not None else self.start_block - 1
        from_block = max(last + 1, self.start_block)
        to_block = latest
        if from_block > to_block:
            return
        await self.backfill_range(from_block, to_block)

    async def backfill_range(self, from_block: int, to_block: int) -> None:
        if not self.w3_http:
            raise RuntimeError("rpc_http is required for backfills")
        current = from_block
        batch_size = self.batch_size

        while current <= to_block:
            batch_to = min(current + batch_size - 1, to_block)
            try:
                logs = self.w3_http.eth.get_logs(
                    {
                        "fromBlock": current,
                        "toBlock": batch_to,
                        "address": self.contract_addresses,
                    }
                )
            except ValueError as exc:
                msg = str(exc).lower()
                if batch_size <= 1:
                    raise
                if "query returned more than" in msg or "too many" in msg:
                    batch_size = max(batch_size // 2, 1)
                    _log(
                        f"WARN: get_logs too large ({current}-{batch_to}), reducing batch size to {batch_size}"
                    )
                    continue
                raise
            logs = sorted(logs, key=lambda x: (x.get("blockNumber", 0), x.get("logIndex", 0)))
            await self._store_logs_batch(logs)
            batch_ts = await self._get_block_timestamp(batch_to)
            await self._update_sync_state(batch_to, batch_ts)
            current = batch_to + 1

    async def subscribe_to_events(self) -> None:
        if websockets is None:
            raise RuntimeError("websockets package not available")
        if not self.rpc_ws:
            raise RuntimeError("rpc_ws is required for websocket subscription")

        backoff = max(self.reconnect_delay, 1)
        max_backoff = 60

        while True:
            try:
                await self.backfill_missed_blocks()
                async with websockets.connect(self.rpc_ws, ping_interval=20, ping_timeout=20) as ws:
                    _log("Websocket connected, subscribing to logs...")
                    sub_id = await self._ws_subscribe(ws)
                    _log(f"Subscribed: {sub_id}")
                    backoff = max(self.reconnect_delay, 1)

                    async for message in ws:
                        payload = json.loads(message)
                        if payload.get("method") == "eth_subscription":
                            log = payload.get("params", {}).get("result")
                            if log:
                                await self._handle_ws_log(log)
                        elif payload.get("id") is not None and payload.get("error"):
                            _log(f"WS error: {payload}")
            except Exception as exc:
                _log(f"Websocket error: {exc}")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, max_backoff)

    async def _ws_subscribe(self, ws: Any) -> str:
        self._ws_id += 1
        req_id = self._ws_id
        payload = {
            "jsonrpc": "2.0",
            "id": req_id,
            "method": "eth_subscribe",
            "params": ["logs", {"address": self.contract_addresses}],
        }
        await ws.send(json.dumps(payload))

        while True:
            message = await ws.recv()
            data = json.loads(message)
            if data.get("id") == req_id:
                if "result" in data:
                    return data["result"]
                raise RuntimeError(f"Subscribe failed: {data}")
            if data.get("method") == "eth_subscription":
                log = data.get("params", {}).get("result")
                if log:
                    await self._handle_ws_log(log)

    async def _handle_ws_log(self, log: Dict[str, Any]) -> None:
        normalized = _normalize_log(log)
        if normalized.get("removed"):
            await self._handle_removed_log(normalized)
            return

        block_number = normalized.get("blockNumber")
        if block_number is not None and self.last_processed_block is not None:
            if block_number > self.last_processed_block + 1:
                await self.backfill_range(self.last_processed_block + 1, block_number - 1)

        await self.process_event(normalized)

    async def process_event(self, log: Dict[str, Any]) -> None:
        if not self.conn:
            raise RuntimeError("DB not initialized")

        normalized = _normalize_log(log)
        decoded = self._decode_log(normalized)
        block_number = normalized.get("blockNumber")
        block_ts = None
        if block_number is not None:
            block_ts = await self._get_block_timestamp(block_number)

        event_record = {
            "block_number": block_number,
            "block_timestamp": block_ts,
            "transaction_hash": normalized.get("transactionHash").hex()
            if normalized.get("transactionHash")
            else None,
            "transaction_index": normalized.get("transactionIndex"),
            "log_index": normalized.get("logIndex"),
            "contract_address": _db_addr(normalized.get("address")),
            "event_name": decoded.get("event_name", "Unknown"),
            "event_signature": decoded.get("event_signature"),
            "raw_data": normalized.get("data").hex() if normalized.get("data") else None,
            "decoded_args": _json_dumps(decoded.get("args", {})),
        }
        await self._insert_event(event_record)
        await self._insert_indexed_args(event_record, decoded.get("indexed_args", {}))

        if block_number is not None:
            await self._update_sync_state(block_number, block_ts)

    def reconstruct_state(self, block_number: int) -> Dict[str, Any]:
        recon = StateReconstructor(self.db_path)
        return recon.at_block(block_number)

    def _decode_log(self, log: Dict[str, Any]) -> Dict[str, Any]:
        address = log.get("address")
        topics = log.get("topics") or []
        topic0 = topics[0].hex() if topics else None

        event_abi = None
        if address in self.topic_to_abi and topic0 in self.topic_to_abi[address]:
            event_abi = self.topic_to_abi[address][topic0]

        decoded_args = {}
        event_name = "Unknown"
        event_signature = topic0

        if event_abi is None:
            for candidate in self.event_abis.get(address, []):
                try:
                    event_data = get_event_data(self.w3_http.codec, candidate, log)
                    event_abi = candidate
                    event_name = event_data.get("event")
                    decoded_args = dict(event_data.get("args", {}))
                    event_signature = event_abi_to_log_topic(candidate).hex()
                    indexed_args = self._extract_indexed_args(candidate, decoded_args)
                    return {
                        "event_name": event_name,
                        "args": decoded_args,
                        "event_signature": event_signature,
                        "indexed_args": indexed_args,
                    }
                except Exception:
                    continue
        else:
            try:
                event_data = get_event_data(self.w3_http.codec, event_abi, log)
                event_name = event_data.get("event")
                decoded_args = dict(event_data.get("args", {}))
                event_signature = event_abi_to_log_topic(event_abi).hex()
                indexed_args = self._extract_indexed_args(event_abi, decoded_args)
            except Exception as exc:
                _log(f"WARN: Failed decoding log for {address}: {exc}")
                indexed_args = {}

        return {
            "event_name": event_name,
            "args": decoded_args,
            "event_signature": event_signature,
            "indexed_args": indexed_args,
        }

    async def _insert_event(self, event: Dict[str, Any]) -> None:
        async with self.db_lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                INSERT OR IGNORE INTO events (
                    block_number, block_timestamp, transaction_hash, transaction_index,
                    log_index, contract_address, event_name, event_signature, raw_data, decoded_args
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event["block_number"],
                    event["block_timestamp"],
                    event["transaction_hash"],
                    event["transaction_index"],
                    event["log_index"],
                    event["contract_address"],
                    event["event_name"],
                    event["event_signature"],
                    event["raw_data"],
                    event["decoded_args"],
                ),
            )
            self.conn.commit()

    async def _insert_indexed_args(self, event: Dict[str, Any], indexed_args: Dict[str, Any]) -> None:
        if not indexed_args:
            return
        tx_hash = event.get("transaction_hash")
        log_index = event.get("log_index")
        if not tx_hash or log_index is None:
            return
        rows = []
        for name, value in indexed_args.items():
            rows.append(
                (
                    tx_hash,
                    log_index,
                    name,
                    self._stringify_indexed_value(value),
                    event.get("contract_address"),
                    event.get("event_name"),
                    event.get("block_number"),
                )
            )
        async with self.db_lock:
            cur = self.conn.cursor()
            cur.executemany(
                """
                INSERT OR IGNORE INTO event_indexed_args (
                    transaction_hash, log_index, arg_name, arg_value,
                    contract_address, event_name, block_number
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                rows,
            )
            self.conn.commit()

    async def _store_logs_batch(self, logs: List[Dict[str, Any]]) -> None:
        if not logs:
            return
        rows = []
        indexed_rows = []
        for raw in logs:
            normalized = _normalize_log(raw)
            decoded = self._decode_log(normalized)
            block_number = normalized.get("blockNumber")
            block_ts = await self._get_block_timestamp(block_number) if block_number else None
            tx_hash = normalized.get("transactionHash").hex() if normalized.get("transactionHash") else None
            log_index = normalized.get("logIndex")
            contract_address = _db_addr(normalized.get("address"))
            event_name = decoded.get("event_name", "Unknown")
            rows.append(
                (
                    block_number,
                    block_ts,
                    tx_hash,
                    normalized.get("transactionIndex"),
                    log_index,
                    contract_address,
                    event_name,
                    decoded.get("event_signature"),
                    normalized.get("data").hex() if normalized.get("data") else None,
                    _json_dumps(decoded.get("args", {})),
                )
            )
            if tx_hash is not None and log_index is not None:
                for name, value in decoded.get("indexed_args", {}).items():
                    indexed_rows.append(
                        (
                            tx_hash,
                            log_index,
                            name,
                            self._stringify_indexed_value(value),
                            contract_address,
                            event_name,
                            block_number,
                        )
                    )
        async with self.db_lock:
            cur = self.conn.cursor()
            try:
                cur.executemany(
                    """
                    INSERT OR IGNORE INTO events (
                        block_number, block_timestamp, transaction_hash, transaction_index,
                        log_index, contract_address, event_name, event_signature, raw_data, decoded_args
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    rows,
                )
                if indexed_rows:
                    cur.executemany(
                        """
                        INSERT OR IGNORE INTO event_indexed_args (
                            transaction_hash, log_index, arg_name, arg_value,
                            contract_address, event_name, block_number
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        indexed_rows,
                    )
                self.conn.commit()
            except Exception:
                self.conn.rollback()
                raise

    async def _update_sync_state(self, block_number: int, block_timestamp: Optional[int]) -> None:
        if block_number is None:
            return
        if self.last_processed_block is not None and block_number < self.last_processed_block:
            return
        async with self.db_lock:
            cur = self.conn.cursor()
            cur.execute(
                """
                UPDATE sync_state
                SET last_processed_block = ?, last_processed_timestamp = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                """,
                (block_number, block_timestamp),
            )
            self.conn.commit()
            self.last_processed_block = block_number
            self.last_processed_timestamp = block_timestamp

    async def _handle_removed_log(self, log: Dict[str, Any]) -> None:
        tx_hash = log.get("transactionHash")
        log_index = log.get("logIndex")
        if not tx_hash or log_index is None:
            return
        async with self.db_lock:
            cur = self.conn.cursor()
            cur.execute(
                "DELETE FROM events WHERE transaction_hash = ? AND log_index = ?",
                (tx_hash.hex() if isinstance(tx_hash, HexBytes) else str(tx_hash), log_index),
            )
            cur.execute(
                "DELETE FROM event_indexed_args WHERE transaction_hash = ? AND log_index = ?",
                (tx_hash.hex() if isinstance(tx_hash, HexBytes) else str(tx_hash), log_index),
            )
            self.conn.commit()

    async def _get_block_timestamp(self, block_number: int) -> Optional[int]:
        if block_number is None:
            return None
        if block_number in self._block_ts_cache:
            return self._block_ts_cache[block_number]
        block = self.w3_http.eth.get_block(block_number)
        ts = block.get("timestamp")
        self._block_ts_cache[block_number] = ts
        return ts

    async def _health_check_loop(self) -> None:
        while True:
            await asyncio.sleep(self.health_check_interval)
            try:
                if not self.w3_http or self.last_processed_block is None:
                    continue
                latest = self.w3_http.eth.block_number
                if latest > self.last_processed_block + self.health_check_threshold:
                    await self.backfill_missed_blocks()
            except Exception as exc:
                _log(f"Health check error: {exc}")

    @staticmethod
    def _extract_indexed_args(event_abi: Dict[str, Any], decoded_args: Dict[str, Any]) -> Dict[str, Any]:
        indexed = {}
        for item in event_abi.get("inputs", []):
            if item.get("indexed") and item.get("name") in decoded_args:
                indexed[item.get("name")] = decoded_args[item.get("name")]
        return indexed

    @staticmethod
    def _stringify_indexed_value(value: Any) -> str:
        if isinstance(value, HexBytes):
            return value.hex()
        if isinstance(value, (bytes, bytearray)):
            return "0x" + value.hex()
        if isinstance(value, (list, dict, tuple)):
            return _json_dumps(value)
        return str(value)


class StateReconstructor:
    def __init__(self, db_path: str):
        self.db_path = db_path
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row
        self.contract_names = self._load_contract_names()

    def _load_contract_names(self) -> Dict[str, str]:
        cur = self.conn.cursor()
        try:
            rows = cur.execute("SELECT address, name FROM contracts").fetchall()
            return {row["address"].lower(): row["name"] for row in rows}
        except sqlite3.OperationalError:
            return {}

    def at_block(self, block_number: int) -> Dict[str, Any]:
        state = self._init_state()
        for event in self._iter_events(block_number):
            self._apply_event(state, event)
        return state

    def player_state(self, address: str, block_number: int) -> Dict[str, Any]:
        state = self.at_block(block_number)
        addr = address.lower()
        player = state["players"].get(addr, {"address": addr})

        token_balances = {}
        for token_addr, token_state in state["tokens"].items():
            name = token_state.get("name") or token_addr
            bal = token_state["balances"].get(addr, 0)
            token_balances[name] = bal

        nft_holdings = {}
        for nft_addr, nft_state in state["nfts"].items():
            name = nft_state.get("name") or nft_addr
            token_ids = [tid for tid, owner in nft_state["owners"].items() if owner == addr]
            if token_ids:
                nft_holdings[name] = sorted(token_ids)

        player["token_balances"] = token_balances
        player["nft_holdings"] = nft_holdings
        return player

    def game_state(self, block_number: int) -> Dict[str, Any]:
        state = self.at_block(block_number)
        return state["game"]

    def _iter_events(self, block_number: int) -> Iterable[Dict[str, Any]]:
        cur = self.conn.cursor()
        rows = cur.execute(
            """
            SELECT block_number, block_timestamp, transaction_hash, log_index,
                   contract_address, event_name, decoded_args
            FROM events
            WHERE block_number <= ?
            ORDER BY block_number ASC, log_index ASC
            """,
            (block_number,),
        )
        for row in rows:
            args = {}
            if row["decoded_args"]:
                try:
                    args = json.loads(row["decoded_args"])
                except json.JSONDecodeError:
                    args = {}
            yield {
                "block_number": row["block_number"],
                "block_timestamp": row["block_timestamp"],
                "transaction_hash": row["transaction_hash"],
                "log_index": row["log_index"],
                "contract_address": row["contract_address"],
                "event_name": row["event_name"],
                "args": args,
            }

    def _init_state(self) -> Dict[str, Any]:
        return {
            "game": {
                "level": 0,
                "phase": None,
                "prize_pools": {
                    "current": 0,
                    "future": 0,
                    "next": 0,
                    "baf": 0,
                    "decimator": 0,
                },
                "trait_counts": [[0, 0, 0, 0] for _ in range(4)],
                "jackpot_counter": 0,
                "last_event_block": None,
            },
            "players": {},
            "tokens": {},
            "nfts": {},
            "gamepieces": {},
            "affiliates": {},
            "events": {"counts": defaultdict(int)},
        }

    def _apply_event(self, state: Dict[str, Any], event: Dict[str, Any]) -> None:
        name = event["event_name"]
        args = event.get("args", {})
        addr = event.get("contract_address")
        if addr:
            addr = addr.lower()

        state["events"]["counts"][name] += 1
        state["game"]["last_event_block"] = event.get("block_number")

        # Core game events (best-effort mapping)
        if name == "PhaseAdvanced":
            if "newPhase" in args:
                state["game"]["phase"] = args["newPhase"]
            elif "phase" in args:
                state["game"]["phase"] = args["phase"]

        if name == "LevelAdvanced":
            if "newLevel" in args:
                state["game"]["level"] = args["newLevel"]
            elif "level" in args:
                state["game"]["level"] = args["level"]

        if name == "PrizePoolUpdated":
            for key in ("current", "future", "next", "baf", "decimator"):
                if key in args:
                    state["game"]["prize_pools"][key] = args[key]

        if name in ("DailyJackpotPaid", "LevelJackpotPaid", "BAFDistributed", "DecimatorPaid"):
            amount = args.get("amount") or args.get("payout") or 0
            pool_map = {
                "DailyJackpotPaid": "current",
                "LevelJackpotPaid": "current",
                "BAFDistributed": "baf",
                "DecimatorPaid": "decimator",
            }
            pool_key = pool_map.get(name)
            if pool_key:
                state["game"]["prize_pools"][pool_key] = max(
                    0, state["game"]["prize_pools"].get(pool_key, 0) - amount
                )

        if name == "GamepieceMinted":
            token_id = args.get("tokenId")
            owner = args.get("to") or args.get("owner")
            traits = args.get("traits")
            if token_id is not None:
                state["gamepieces"][str(token_id)] = {
                    "owner": owner,
                    "traits": traits,
                    "burned": False,
                }
                self._apply_trait_counts(state, traits)

        if name == "GamepieceBurned":
            token_id = args.get("tokenId")
            if token_id is not None and str(token_id) in state["gamepieces"]:
                state["gamepieces"][str(token_id)]["burned"] = True

        if name == "AffiliateRegistered":
            player = (args.get("player") or args.get("account") or "").lower()
            if player:
                state["affiliates"][player] = {
                    "code": args.get("code"),
                    "upline": (args.get("upline") or args.get("referrer")),
                }

        # Generic token / NFT handling via Transfer events
        if name == "Transfer":
            self._apply_transfer(state, addr, args)

        # Heuristic player accounting
        self._apply_player_heuristics(state, name, args)

    def _apply_transfer(self, state: Dict[str, Any], contract_addr: Optional[str], args: Dict[str, Any]) -> None:
        if not contract_addr:
            return
        from_addr = (args.get("from") or "").lower()
        to_addr = (args.get("to") or "").lower()

        # ERC20
        if "value" in args and isinstance(args.get("value"), int):
            token_state = state["tokens"].setdefault(
                contract_addr,
                {
                    "name": self.contract_names.get(contract_addr, contract_addr),
                    "total_supply": 0,
                    "balances": defaultdict(int),
                },
            )
            value = args.get("value", 0)
            if from_addr and from_addr != ZERO_ADDRESS.lower():
                token_state["balances"][from_addr] -= value
            if to_addr and to_addr != ZERO_ADDRESS.lower():
                token_state["balances"][to_addr] += value
            if from_addr == ZERO_ADDRESS.lower():
                token_state["total_supply"] += value
            if to_addr == ZERO_ADDRESS.lower():
                token_state["total_supply"] -= value
            return

        # ERC721
        if "tokenId" in args:
            nft_state = state["nfts"].setdefault(
                contract_addr,
                {
                    "name": self.contract_names.get(contract_addr, contract_addr),
                    "owners": {},
                },
            )
            token_id = str(args.get("tokenId"))
            if to_addr == ZERO_ADDRESS.lower():
                nft_state["owners"].pop(token_id, None)
            else:
                nft_state["owners"][token_id] = to_addr

    def _apply_trait_counts(self, state: Dict[str, Any], traits: Any) -> None:
        if traits is None:
            return
        trait_counts = state["game"]["trait_counts"]
        if isinstance(traits, (list, tuple)) and len(traits) == 4:
            for idx, value in enumerate(traits):
                try:
                    trait_index = int(value)
                except (TypeError, ValueError):
                    continue
                if 0 <= idx < 4 and 0 <= trait_index < 4:
                    trait_counts[idx][trait_index] += 1

    def _apply_player_heuristics(self, state: Dict[str, Any], name: str, args: Dict[str, Any]) -> None:
        player_keys = ["player", "account", "owner", "sender", "to"]
        player_addr = None
        for key in player_keys:
            if key in args:
                player_addr = str(args[key]).lower()
                break
        if not player_addr or player_addr == ZERO_ADDRESS.lower():
            return

        player = state["players"].setdefault(
            player_addr,
            {
                "address": player_addr,
                "eth_deposited": 0,
                "tickets": {"current": 0, "future": 0},
                "activity": {},
            },
        )

        # Deposit/withdraw heuristics
        if name in ("Deposit", "Deposited"):
            amount = args.get("assets") or args.get("amount") or args.get("value") or 0
            player["eth_deposited"] += amount
        if name in ("Withdraw", "Withdrawal", "Withdrawn"):
            amount = args.get("assets") or args.get("amount") or args.get("value") or 0
            player["eth_deposited"] = max(0, player["eth_deposited"] - amount)

        # Ticket heuristics
        if "tickets" in args:
            player["tickets"]["current"] += args.get("tickets", 0)
        if "futureTickets" in args:
            player["tickets"]["future"] += args.get("futureTickets", 0)


def load_config(path: str) -> Dict[str, Any]:
    cfg = _load_json(path)
    if "rpc_ws" not in cfg:
        cfg["rpc_ws"] = None
    if "rpc_http" not in cfg:
        cfg["rpc_http"] = None
    return cfg


def _resolve_contract_name(conn: sqlite3.Connection, value: str) -> Optional[str]:
    if not value:
        return None
    cur = conn.cursor()
    row = cur.execute(
        "SELECT address FROM contracts WHERE name = ? COLLATE NOCASE", (value,)
    ).fetchone()
    if row:
        return row["address"]
    if value.startswith("0x") and len(value) == 42:
        return value.lower()
    return None


def _query_events(
    conn: sqlite3.Connection,
    contract: Optional[str],
    name: Optional[str],
    limit: int = 200,
) -> List[Dict[str, Any]]:
    params: List[Any] = []
    clauses = []
    if contract:
        clauses.append("contract_address = ?")
        params.append(contract.lower())
    if name:
        clauses.append("event_name = ?")
        params.append(name)

    where = " AND ".join(clauses)
    if where:
        where = "WHERE " + where
    sql = (
        "SELECT block_number, block_timestamp, transaction_hash, log_index, contract_address, "
        "event_name, event_signature, decoded_args "
        f"FROM events {where} ORDER BY block_number DESC, log_index DESC LIMIT ?"
    )
    params.append(limit)
    cur = conn.cursor()
    rows = cur.execute(sql, params).fetchall()
    result = []
    for row in rows:
        decoded_args = None
        if row["decoded_args"]:
            try:
                decoded_args = json.loads(row["decoded_args"])
            except json.JSONDecodeError:
                decoded_args = row["decoded_args"]
        result.append(
            {
                "block_number": row["block_number"],
                "block_timestamp": row["block_timestamp"],
                "transaction_hash": row["transaction_hash"],
                "log_index": row["log_index"],
                "contract_address": row["contract_address"],
                "event_name": row["event_name"],
                "event_signature": row["event_signature"],
                "decoded_args": decoded_args,
            }
        )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Degenerus Protocol Event Indexer")
    parser.add_argument("--config", default="config.json", help="Path to config JSON")

    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("run", help="Start indexing")

    backfill_parser = sub.add_parser("backfill", help="Manual backfill")
    backfill_parser.add_argument("--from-block", type=int, required=True)
    backfill_parser.add_argument("--to-block", type=int, default=None)

    state_parser = sub.add_parser("state", help="Reconstruct state at a block")
    state_parser.add_argument("--block", type=int, required=True)

    events_parser = sub.add_parser("events", help="Query events")
    events_parser.add_argument("--contract", type=str, default=None)
    events_parser.add_argument("--name", type=str, default=None)
    events_parser.add_argument("--limit", type=int, default=200)

    args = parser.parse_args()
    cfg = load_config(args.config)

    if args.command == "run":
        indexer = EventIndexer(cfg)
        asyncio.run(indexer.start())
        return

    if args.command == "backfill":
        async def _run_backfill() -> None:
            indexer = EventIndexer(cfg)
            await indexer.init_db()
            await indexer.load_contracts()
            to_block = args.to_block
            if to_block is None:
                if not indexer.w3_http:
                    raise RuntimeError("rpc_http is required")
                to_block = indexer.w3_http.eth.block_number
            await indexer.backfill_range(args.from_block, to_block)

        asyncio.run(_run_backfill())
        return

    if args.command == "state":
        recon = StateReconstructor(cfg.get("db_path", "./events.db"))
        state = recon.at_block(args.block)
        print(_json_dumps(state))
        return

    if args.command == "events":
        conn = sqlite3.connect(cfg.get("db_path", "./events.db"))
        conn.row_factory = sqlite3.Row
        contract_addr = _resolve_contract_name(conn, args.contract) if args.contract else None
        events = _query_events(conn, contract_addr, args.name, args.limit)
        print(_json_dumps(events))
        return


if __name__ == "__main__":
    main()
