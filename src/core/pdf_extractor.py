from pathlib import Path
from typing import Any, Optional
from pypdf import PdfReader

class PDFExtractor:
    @staticmethod
    def get_info(pdf_path: Path) -> dict[str, Any]:
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        reader = PdfReader(str(pdf_path))
        num_pages = len(reader.pages)
        meta = reader.metadata or {}

        # Extract outline bookmarks if available
        outline_titles = []
        try:
            outline = reader.outline
            if outline:
                for item in outline:
                    if hasattr(item, "title") and item.title:
                        outline_titles.append(str(item.title).strip())
        except Exception:
            pass

        return {
            "num_pages": num_pages,
            "title": meta.get("/Title", ""),
            "author": meta.get("/Author", ""),
            "outline": outline_titles[:30],
        }

    @staticmethod
    def extract_text(
        pdf_path: Path,
        start_page: int = 1,
        end_page: Optional[int] = None,
        max_chars: int = 30000,
    ) -> dict[str, Any]:
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        reader = PdfReader(str(pdf_path))
        total_pages = len(reader.pages)

        # Normalize 1-indexed pages
        start = max(1, start_page)
        if start > total_pages:
            return {
                "total_pages": total_pages,
                "start_page": start,
                "end_page": start,
                "extracted_pages_count": 0,
                "total_chars": 0,
                "is_truncated": False,
                "content": f"[页码越界：起始页码 {start} 超出文档总页数 {total_pages}]",
            }

        end = min(total_pages, max(start, end_page)) if end_page else min(total_pages, start + 9)

        extracted_pages = []
        total_chars = 0
        truncated = False

        for p_num in range(start, end + 1):
            page = reader.pages[p_num - 1]
            p_text = page.extract_text() or ""
            p_text = p_text.strip()

            if total_chars + len(p_text) > max_chars:
                allowed = max(0, max_chars - total_chars)
                extracted_pages.append({
                    "page": p_num,
                    "text": p_text[:allowed] + "\n... [Page text truncated to prevent context overflow] ...",
                })
                total_chars += allowed
                truncated = True
                break

            extracted_pages.append({
                "page": p_num,
                "text": p_text,
            })
            total_chars += len(p_text)

        full_content = "\n\n".join(
            f"--- Page {p['page']} ---\n{p['text']}" for p in extracted_pages
        )

        return {
            "total_pages": total_pages,
            "start_page": start,
            "end_page": end,
            "extracted_pages_count": len(extracted_pages),
            "total_chars": total_chars,
            "is_truncated": truncated,
            "content": full_content,
        }
