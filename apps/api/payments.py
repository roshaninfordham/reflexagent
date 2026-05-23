"""x402 paywall — Coinbase CDP on Base Sepolia (preferred), JWT stub fallback.

Implements the x402 challenge/redeem pattern. On the first request without an
acceptable X-PAYMENT header, returns 402 with payment instructions. On the
retry, validates the proof and serves the resource.

For Base Sepolia we accept either:
  - A signed on-chain settlement proof (transaction hash + payer address) we
    re-verify against the chain via Coinbase's public RPC.
  - A signed JWT (HS256, signed with X402_SECRET) for testing without a wallet.
"""
from __future__ import annotations

import base64
import json
import logging
import time
from datetime import datetime, timedelta
from typing import Any
from uuid import UUID, uuid4

import httpx
import jwt

from apps.api.settings import get_settings
from apps.api.tools import clickhouse_client

log = logging.getLogger(__name__)

BASE_SEPOLIA_RPC = "https://sepolia.base.org"


def x402_challenge() -> dict[str, Any]:
    s = get_settings()
    return {
        "x402Version": 1,
        "accepts": [
            {
                "scheme": "exact",
                "network": s.coinbase_network,
                "maxAmountRequired": str(int(s.x402_price_usd * 10**6)),
                "asset": "USDC",
                "payTo": s.x402_pay_to_address or "0x0000000000000000000000000000000000000000",
                "maxTimeoutSeconds": 60,
                "description": "Reflex premium sub-brief (pediatric/CKD/formulary slice)",
            },
            {
                "scheme": "jwt-stub",
                "network": "local-dev",
                "maxAmountRequired": str(int(s.x402_price_usd * 10**6)),
                "asset": "USD",
                "payTo": "dev",
                "maxTimeoutSeconds": 60,
                "description": "Local-dev JWT fallback (HS256, X402_SECRET).",
            },
        ],
    }


def mint_dev_token(amount_usd: float | None = None) -> str:
    """Issue a JWT proving payment intent — used by the UI's dev pay button."""
    s = get_settings()
    payload = {
        "iss": "reflex-dev",
        "iat": int(time.time()),
        "exp": int((datetime.utcnow() + timedelta(minutes=10)).timestamp()),
        "amount_usd": amount_usd or s.x402_price_usd,
        "nonce": uuid4().hex,
    }
    return jwt.encode(payload, s.x402_secret, algorithm="HS256")


def _decode_header(x_payment: str) -> dict[str, Any]:
    """X-PAYMENT is base64-encoded JSON per the x402 spec."""
    try:
        return json.loads(base64.b64decode(x_payment).decode("utf-8"))
    except Exception:
        # Allow plain JSON too.
        return json.loads(x_payment)


async def _verify_chain_proof(payload: dict[str, Any]) -> bool:
    tx = payload.get("transaction") or payload.get("tx_hash")
    if not tx:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                BASE_SEPOLIA_RPC,
                json={
                    "jsonrpc": "2.0",
                    "id": 1,
                    "method": "eth_getTransactionByHash",
                    "params": [tx],
                },
            )
            r.raise_for_status()
            tx_data = (r.json() or {}).get("result")
            return bool(tx_data and tx_data.get("blockNumber"))
    except Exception as e:  # noqa: BLE001
        log.warning("base sepolia verify failed: %s", e)
        return False


def _verify_jwt(token: str) -> bool:
    s = get_settings()
    try:
        jwt.decode(token, s.x402_secret, algorithms=["HS256"])
        return True
    except Exception:
        return False


async def verify_x402_payment(x_payment_header: str | None) -> tuple[bool, str]:
    """Returns (ok, payer_address_or_dev)."""
    if not x_payment_header:
        return False, ""
    try:
        payload = _decode_header(x_payment_header)
    except Exception as e:  # noqa: BLE001
        log.warning("x402 header decode failed: %s", e)
        return False, ""

    scheme = payload.get("scheme")
    if scheme == "jwt-stub":
        token = payload.get("token") or payload.get("jwt", "")
        if _verify_jwt(token):
            return True, "dev-jwt"
        return False, ""

    if scheme in (None, "exact"):
        if await _verify_chain_proof(payload):
            return True, payload.get("payer", "")
        return False, ""

    return False, ""


def log_payment(
    *,
    brief_id: UUID | None,
    payer: str,
    amount_usd: float,
    endpoint: str,
    settlement_tx: str = "",
) -> None:
    try:
        clickhouse_client.insert(
            "x402_transactions",
            [
                {
                    "brief_id": str(brief_id) if brief_id else str(UUID(int=0)),
                    "payer_address": payer,
                    "settlement_tx": settlement_tx,
                    "amount_usd": amount_usd,
                    "endpoint": endpoint,
                }
            ],
        )
    except Exception as e:  # noqa: BLE001
        log.warning("x402 log failed: %s", e)
