"""Unit tests for utils/sse.py — pure helpers, no external calls."""
import asyncio
import json

import pytest

from utils.sse import sse, sse_event, sse_error, sse_done, stream_with_cleanup


def test_sse_basic_format():
    out = sse("token", '{"text":"hi"}')
    assert out == 'event: token\ndata: {"text":"hi"}\n\n'


def test_sse_event_auto_jsons_dict():
    out = sse_event("design", {"a": 1})
    assert out.startswith("event: design\n")
    assert 'data: {"a": 1}' in out
    assert out.endswith("\n\n")


def test_sse_event_passes_string_through():
    out = sse_event("token", "raw")
    assert "data: raw\n\n" in out


def test_sse_error_includes_message():
    out = sse_error("boom")
    payload = json.loads(out.split("data: ", 1)[1].rstrip())
    assert payload == {"message": "boom"}


def test_sse_error_with_code():
    out = sse_error("nope", code="E_X")
    payload = json.loads(out.split("data: ", 1)[1].rstrip())
    assert payload == {"message": "nope", "code": "E_X"}


def test_sse_done_default_empty():
    assert sse_done() == "event: done\ndata: {}\n\n"


def test_sse_done_with_extra():
    out = sse_done({"reason": "ok"})
    payload = json.loads(out.split("data: ", 1)[1].rstrip())
    assert payload == {"reason": "ok"}


# ── stream_with_cleanup ───────────────────────────────────────────────


async def _collect(gen):
    out = []
    async for chunk in gen:
        out.append(chunk)
    return out


@pytest.mark.asyncio
async def test_stream_with_cleanup_passes_through():
    async def src():
        yield "a"
        yield "b"

    out = await _collect(stream_with_cleanup(src()))
    assert out == ["a", "b"]


@pytest.mark.asyncio
async def test_stream_with_cleanup_emits_sse_error_on_exception():
    async def src():
        yield "first"
        raise RuntimeError("boom")

    out = await _collect(stream_with_cleanup(src()))
    assert out[0] == "first"
    assert "event: error" in out[-1]
    assert "boom" in out[-1]


@pytest.mark.asyncio
async def test_stream_with_cleanup_runs_on_disconnect_on_generator_exit():
    cleanup_ran = False

    async def src():
        yield "x"
        await asyncio.sleep(10)

    def on_disconnect():
        nonlocal cleanup_ran
        cleanup_ran = True

    wrapped = stream_with_cleanup(src(), on_disconnect=on_disconnect)
    async for _ in wrapped:
        break  # consumer drops out → aclose() → GeneratorExit
    await wrapped.aclose()
    assert cleanup_ran is True
