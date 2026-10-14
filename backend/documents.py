import io
import re
from pathlib import Path
from pypdf import PdfReader

MAX_BYTES = 5 * 1024 * 1024
MAX_CHARS = 150_000


def extract_pages(filename: str, data: bytes) -> list[tuple[int, str]]:
    if len(data) > MAX_BYTES:
        raise ValueError('Files must be 5 MB or smaller.')
    suffix = Path(filename).suffix.lower()
    if suffix in {'.md', '.markdown'}:
        try:
            pages = [(1, data.decode('utf-8-sig'))]
        except UnicodeDecodeError as exc:
            raise ValueError('Markdown must use UTF-8 encoding.') from exc
    elif suffix == '.pdf':
        if not data.startswith(b'%PDF-'):
            raise ValueError('This file is not a valid PDF.')
        try:
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted:
                raise ValueError('Password-protected PDFs are not supported.')
            if len(reader.pages) > 100:
                raise ValueError('PDFs must contain at most 100 pages.')
            pages = [(i + 1, page.extract_text() or '') for i, page in enumerate(reader.pages)]
        except ValueError:
            raise
        except Exception as exc:
            raise ValueError('Unable to read this PDF.') from exc
    else:
        raise ValueError('Upload a PDF or Markdown file.')
    if sum(len(text) for _, text in pages) > MAX_CHARS:
        raise ValueError('Document is too long (150,000 character limit).')
    if not any(text.strip() for _, text in pages):
        raise ValueError('No readable text found. Scanned PDFs need OCR first.')
    return pages


def chunk_pages(pages: list[tuple[int, str]], size: int = 850, overlap: int = 140) -> list[dict]:
    """Paragraph-aware overlapping chunks, retaining source page numbers."""
    chunks = []
    for page, raw in pages:
        text = re.sub(r'[ \t]+', ' ', raw).strip()
        start = 0
        while start < len(text):
            end = min(start + size, len(text))
            if end < len(text):
                boundary = max(text.rfind('\n', start + size // 2, end), text.rfind('. ', start + size // 2, end))
                if boundary > start:
                    end = boundary + 1
            content = text[start:end].strip()
            if content:
                chunks.append({'page': page, 'text': content, 'index': len(chunks)})
            if end == len(text):
                break
            start = max(start + 1, end - overlap)
    return chunks
