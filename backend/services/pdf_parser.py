import asyncio
import io
from pypdf import PdfReader

from config import settings


def extract_text_from_pdf(file_bytes: bytes) -> str:
    reader = PdfReader(io.BytesIO(file_bytes))
    pages = [page.extract_text() or "" for page in reader.pages]
    text = "\n\n".join(p.strip() for p in pages if p.strip())
    if not text:
        raise ValueError("Could not extract text from PDF. Try a text-based PDF (not scanned image).")
    return text


async def aextract_text_from_pdf(file_bytes: bytes) -> str:
    """Async wrapper: runs sync extraction in a thread with a timeout from settings."""
    try:
        return await asyncio.wait_for(
            asyncio.to_thread(extract_text_from_pdf, file_bytes),
            timeout=settings.pdf_parse_timeout_seconds,
        )
    except asyncio.TimeoutError as exc:
        raise ValueError(
            f"PDF parsing exceeded {settings.pdf_parse_timeout_seconds:.0f}s timeout"
        ) from exc
