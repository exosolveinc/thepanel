"""AWS Bedrock Titan Embeddings v2.

`embed(text)` is sync — must be wrapped in `asyncio.to_thread` from async code.
`aembed(text)` is the async wrapper; prefer it from coroutines.
"""
import asyncio
import json
import boto3
from config import settings

# Model produces 1024-dim vectors
EMBEDDING_MODEL = "amazon.titan-embed-text-v2:0"
EMBEDDING_DIMS  = 1024
MAX_INPUT_CHARS = 8000   # ~6K tokens, well within Titan v2's 8K token limit


def _bedrock():
    return boto3.client(
        "bedrock-runtime",
        region_name=settings.aws_region,
        aws_access_key_id=settings.aws_access_key_id,
        aws_secret_access_key=settings.aws_secret_access_key,
    )


def embed(text: str) -> list[float]:
    """Synchronous — call via asyncio.to_thread to avoid blocking the event loop.
    Returns a 1024-dim float vector for the given text.
    """
    if not settings.aws_access_key_id or not settings.aws_secret_access_key:
        raise RuntimeError("AWS credentials not configured for embeddings")
    resp = _bedrock().invoke_model(
        modelId=EMBEDDING_MODEL,
        body=json.dumps({"inputText": text[:MAX_INPUT_CHARS]}),
        contentType="application/json",
        accept="application/json",
    )
    return json.loads(resp["body"].read())["embedding"]


async def aembed(text: str) -> list[float]:
    return await asyncio.to_thread(embed, text)
