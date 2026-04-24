"""Unit tests for services/pdf_parser.py — sync extract + async wrapper + timeout."""
import asyncio
import io

import pytest
from pypdf import PdfWriter

from services.pdf_parser import (
    extract_text_from_pdf,
    aextract_text_from_pdf,
)
from services import pdf_parser as pdf_parser_module


def _build_pdf_bytes(num_blank_pages: int = 1) -> bytes:
    """Generate a syntactically valid PDF with `num_blank_pages` blank pages."""
    writer = PdfWriter()
    for _ in range(num_blank_pages):
        writer.add_blank_page(width=72, height=72)
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_extract_raises_on_empty_blank_pdf():
    # Blank page → no extractable text → ValueError
    with pytest.raises(ValueError, match="Could not extract text"):
        extract_text_from_pdf(_build_pdf_bytes(num_blank_pages=1))


def test_extract_raises_on_invalid_bytes():
    with pytest.raises(Exception):
        extract_text_from_pdf(b"not-a-pdf")


@pytest.mark.asyncio
async def test_aextract_propagates_value_error_on_blank():
    with pytest.raises(ValueError):
        await aextract_text_from_pdf(_build_pdf_bytes(num_blank_pages=1))


@pytest.mark.asyncio
async def test_aextract_raises_value_error_on_timeout(monkeypatch):
    # Force the async wrapper to time out by stubbing to_thread to take longer.
    async def slow_to_thread(_fn, *_args, **_kwargs):
        await asyncio.sleep(5)
        return "should-not-reach"

    monkeypatch.setattr(pdf_parser_module.asyncio, "to_thread", slow_to_thread)
    monkeypatch.setattr(pdf_parser_module.settings, "pdf_parse_timeout_seconds", 0.05)

    with pytest.raises(ValueError, match="timeout"):
        await aextract_text_from_pdf(b"anything")
