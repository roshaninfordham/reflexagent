"""Server-side burner wallet for Base Sepolia (testnet, zero real money).

Generates an eth_account wallet on first run, persists the private key to
.env, and provides helpers to:
  - check ETH and USDC balances
  - sign + broadcast a USDC transfer (real on-chain tx)
  - wait for the receipt

All transactions are on Base Sepolia testnet. Base Sepolia USDC is faucet-
issued and has no monetary value. Receipts show on https://sepolia.basescan.org.
"""
from __future__ import annotations

import json
import logging
import os
import time
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx
from eth_account import Account
from eth_account.signers.local import LocalAccount

log = logging.getLogger(__name__)

# Base Sepolia constants.
BASE_SEPOLIA_RPC = "https://sepolia.base.org"
BASE_SEPOLIA_CHAIN_ID = 84532
# Circle's canonical Base Sepolia USDC.
USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
USDC_DECIMALS = 6

# Function selector for ERC-20 transfer(address,uint256) = first 4 bytes of
# keccak("transfer(address,uint256)") = 0xa9059cbb
TRANSFER_SELECTOR = "a9059cbb"
# Function selector for balanceOf(address) = 0x70a08231
BALANCE_OF_SELECTOR = "70a08231"

BASESCAN_TX = "https://sepolia.basescan.org/tx/"
BASESCAN_ADDR = "https://sepolia.basescan.org/address/"


# ----- Wallet lifecycle -----


@lru_cache(maxsize=1)
def get_account() -> LocalAccount:
    pk = os.environ.get("BURNER_PRIVATE_KEY", "").strip()
    if not pk:
        pk = _generate_and_persist()
    if not pk.startswith("0x"):
        pk = "0x" + pk
    return Account.from_key(pk)


def _generate_and_persist() -> str:
    acct = Account.create()
    pk = acct.key.hex()
    log.info("Generated new burner wallet %s", acct.address)
    _persist_to_env("BURNER_PRIVATE_KEY", pk)
    return pk


def _persist_to_env(key: str, value: str) -> None:
    """Append the key=value to project .env (idempotent)."""
    env_path = Path(__file__).resolve().parent.parent.parent / ".env"
    if env_path.exists():
        text = env_path.read_text()
        if f"\n{key}=" in text or text.startswith(f"{key}="):
            return  # already present
        if not text.endswith("\n"):
            text += "\n"
        env_path.write_text(text + f"{key}={value}\n")
    else:
        env_path.write_text(f"{key}={value}\n")
    os.environ[key] = value


def info() -> dict[str, Any]:
    """Return wallet status (address + balances + faucet links + explorer link)."""
    acct = get_account()
    return {
        "address": acct.address,
        "address_url": BASESCAN_ADDR + acct.address,
        "chain": "base-sepolia",
        "chain_id": BASE_SEPOLIA_CHAIN_ID,
        "eth_balance_wei": eth_balance_wei(acct.address),
        "usdc_balance_micro": usdc_balance_micro(acct.address),
        "usdc_decimals": USDC_DECIMALS,
        "faucets": {
            "eth_primary": "https://portal.cdp.coinbase.com/products/faucet",
            "eth_fallbacks": [
                "https://www.alchemy.com/faucets/base-sepolia",
                "https://bwarelabs.com/faucets/base-sepolia",
                "https://learnweb3.io/faucets/base_sepolia/",
            ],
            "usdc": "https://faucet.circle.com",
            "instructions": (
                "1. Open the Circle USDC faucet, paste the wallet address, choose 'Base Sepolia', request 10 USDC. "
                "2. Open any of the Base Sepolia ETH faucets, paste the address, request a small amount of ETH for gas. "
                "All are free; some require a free signup (Alchemy, LearnWeb3) but Bware Labs is open."
            ),
        },
    }


# ----- Low-level RPC -----


def _rpc(method: str, params: list[Any]) -> Any:
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}
    with httpx.Client(timeout=15) as client:
        r = client.post(BASE_SEPOLIA_RPC, json=payload)
        r.raise_for_status()
        body = r.json()
    if "error" in body:
        raise RuntimeError(f"RPC {method} error: {body['error']}")
    return body.get("result")


def eth_balance_wei(address: str) -> int:
    try:
        return int(_rpc("eth_getBalance", [address, "latest"]), 16)
    except Exception as e:  # noqa: BLE001
        log.warning("eth_getBalance failed: %s", e)
        return 0


def usdc_balance_micro(address: str) -> int:
    try:
        calldata = "0x" + BALANCE_OF_SELECTOR + address[2:].lower().rjust(64, "0")
        result = _rpc("eth_call", [{"to": USDC_CONTRACT, "data": calldata}, "latest"])
        return int(result or "0x0", 16)
    except Exception as e:  # noqa: BLE001
        log.warning("usdc balanceOf failed: %s", e)
        return 0


def _gas_price_wei() -> int:
    try:
        return int(_rpc("eth_gasPrice", []), 16)
    except Exception:
        return 1_000_000  # 0.001 gwei fallback


def _nonce(address: str) -> int:
    return int(_rpc("eth_getTransactionCount", [address, "pending"]), 16)


# ----- The actual transfer -----


def send_usdc(amount_usd: float, to: str) -> dict[str, Any]:
    """Sign + broadcast a real Base Sepolia USDC transfer.

    Returns: {tx_hash, explorer_url, ...}
    Raises if balance is insufficient or RPC fails.
    """
    acct = get_account()
    micro = int(round(amount_usd * (10 ** USDC_DECIMALS)))

    bal = usdc_balance_micro(acct.address)
    if bal < micro:
        raise RuntimeError(
            f"Burner wallet USDC balance ({bal / 10**USDC_DECIMALS:.4f}) "
            f"is below the required {amount_usd}. "
            f"Fund {acct.address} via https://faucet.circle.com"
        )
    eth_bal = eth_balance_wei(acct.address)
    if eth_bal < 50_000 * 10**9:  # need at least ~50k gwei for gas
        raise RuntimeError(
            f"Burner wallet has 0 ETH for gas. "
            f"Fund {acct.address} via https://www.coinbase.com/faucets/base-sepolia-faucet"
        )

    # Build the ERC-20 transfer calldata.
    calldata = (
        "0x"
        + TRANSFER_SELECTOR
        + to[2:].lower().rjust(64, "0")
        + hex(micro)[2:].rjust(64, "0")
    )

    tx = {
        "to": USDC_CONTRACT,
        "value": 0,
        "data": calldata,
        "chainId": BASE_SEPOLIA_CHAIN_ID,
        "nonce": _nonce(acct.address),
        "gas": 120_000,
        "gasPrice": int(_gas_price_wei() * 1.2),
    }

    signed = Account.sign_transaction(tx, acct.key)
    raw = "0x" + signed.raw_transaction.hex() if not signed.raw_transaction.hex().startswith("0x") else signed.raw_transaction.hex()
    tx_hash = _rpc("eth_sendRawTransaction", [raw])

    return {
        "tx_hash": tx_hash,
        "explorer_url": BASESCAN_TX + tx_hash,
        "from": acct.address,
        "to": to,
        "amount_usd": amount_usd,
        "chain": "base-sepolia",
        "submitted_at": time.time(),
    }


def wait_for_receipt(tx_hash: str, timeout: int = 30) -> dict[str, Any] | None:
    """Poll for tx receipt. Returns None on timeout."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            r = _rpc("eth_getTransactionReceipt", [tx_hash])
            if r:
                return {
                    "block_number": int(r["blockNumber"], 16) if r.get("blockNumber") else None,
                    "status": int(r.get("status", "0x0"), 16),
                    "gas_used": int(r.get("gasUsed", "0x0"), 16),
                }
        except Exception:
            pass
        time.sleep(1.5)
    return None
