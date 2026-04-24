"""Retry decorator for LLM/API calls. Retries only on transient network/timeout errors."""
import anthropic
import httpx
from botocore.exceptions import ConnectTimeoutError, ReadTimeoutError
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

_TRANSIENT = (
    httpx.TimeoutException,
    httpx.ConnectError,
    anthropic.APITimeoutError,
    anthropic.APIConnectionError,
    ConnectTimeoutError,
    ReadTimeoutError,
    ConnectionError,
)


def with_llm_retry(max_attempts: int = 3):
    """Decorator: retry on transient errors with exponential backoff (1s, 2s, 4s, capped at 8s)."""
    return retry(
        stop=stop_after_attempt(max_attempts),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        retry=retry_if_exception_type(_TRANSIENT),
        reraise=True,
    )
