"""Centralized settings loaded from environment / .env."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


ROOT = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT / ".env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # Reasoning provider — defaults to NVIDIA NIM (OpenAI-compatible).
    reasoning_provider: str = Field(default="nvidia", alias="REASONING_PROVIDER")  # 'nvidia' | 'anthropic'
    nvidia_api_key: str = Field(default="", alias="NVIDIA_API_KEY")
    nvidia_base_url: str = Field(
        default="https://integrate.api.nvidia.com/v1", alias="NVIDIA_BASE_URL"
    )
    nvidia_text_model: str = Field(
        default="meta/llama-3.3-70b-instruct", alias="NVIDIA_TEXT_MODEL"
    )
    nvidia_vision_model: str = Field(
        default="meta/llama-3.2-90b-vision-instruct", alias="NVIDIA_VISION_MODEL"
    )

    anthropic_api_key: str = Field(default="", alias="ANTHROPIC_API_KEY")
    anthropic_model: str = Field(default="claude-sonnet-4-5", alias="ANTHROPIC_MODEL")

    nimble_api_key: str = Field(default="", alias="NIMBLE_API_KEY")
    nimble_base_url: str = Field(
        default="https://api.webit.live", alias="NIMBLE_BASE_URL"
    )

    clickhouse_host: str = Field(default="", alias="CLICKHOUSE_HOST")
    clickhouse_port: int = Field(default=8443, alias="CLICKHOUSE_PORT")
    clickhouse_user: str = Field(default="default", alias="CLICKHOUSE_USER")
    clickhouse_password: str = Field(default="", alias="CLICKHOUSE_PASSWORD")
    clickhouse_database: str = Field(default="reflex", alias="CLICKHOUSE_DATABASE")

    senso_api_key: str = Field(default="", alias="SENSO_API_KEY")
    senso_base_url: str = Field(default="https://api.senso.ai", alias="SENSO_BASE_URL")
    senso_publish_target: str = Field(
        default="reflex.cited.md", alias="SENSO_PUBLISH_TARGET"
    )

    x402_secret: str = Field(
        default="local-dev-secret-change-in-prod", alias="X402_SECRET"
    )
    x402_pay_to_address: str = Field(default="", alias="X402_PAY_TO_ADDRESS")
    x402_price_usd: float = Field(default=0.50, alias="X402_PRICE_USD")
    coinbase_api_key: str = Field(default="", alias="COINBASE_API_KEY")
    coinbase_api_secret: str = Field(default="", alias="COINBASE_API_SECRET")
    coinbase_network: str = Field(default="base-sepolia", alias="COINBASE_NETWORK")

    reflex_bearer_token: str = Field(
        default="local-dev-token-change-in-prod", alias="REFLEX_BEARER_TOKEN"
    )
    reflex_api_base: str = Field(
        default="http://localhost:8000", alias="REFLEX_API_BASE"
    )
    reflex_web_base: str = Field(
        default="http://localhost:3000", alias="REFLEX_WEB_BASE"
    )

    monitor_enabled: bool = Field(default=True, alias="MONITOR_ENABLED")
    monitor_poll_interval_seconds: int = Field(
        default=30, alias="MONITOR_POLL_INTERVAL_SECONDS"
    )

    dd_llmobs_enabled: bool = Field(default=True, alias="DD_LLMOBS_ENABLED")
    dd_llmobs_ml_app: str = Field(default="reflex", alias="DD_LLMOBS_ML_APP")
    dd_api_key: str = Field(default="", alias="DD_API_KEY")
    dd_site: str = Field(default="datadoghq.com", alias="DD_SITE")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
