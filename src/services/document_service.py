import asyncio
from pathlib import Path
from typing import Any, Optional, Tuple

from src.core.db import ZoteroDB
from src.core.storage import StorageResolver
from src.core.pdf_extractor import PDFExtractor
from src.services.validation import validate_8char_key

class DocumentService:
    def __init__(
        self,
        db: Optional[ZoteroDB] = None,
        storage: Optional[StorageResolver] = None,
    ):
        self.db = db or ZoteroDB()
        self.storage = storage or StorageResolver()

    def resolve_pdf_path(self, attachment_key: str, raw_path: Optional[str] = None) -> Optional[Path]:
        """
        Validates attachment key and safely resolves the PDF path on disk.
        """
        if not validate_8char_key(attachment_key):
            return None
        return self.storage.resolve_pdf_path(attachment_key, raw_path)

    async def resolve_pdf_path_async(self, attachment_key: str, raw_path: Optional[str] = None) -> Optional[Path]:
        return await asyncio.to_thread(self.resolve_pdf_path, attachment_key, raw_path)

    def resolve_pdf_for_item(self, item_key: str) -> Tuple[Optional[dict[str, Any]], Optional[Path]]:
        """
        Looks up the PDF attachment record for a given item_key and resolves its physical path.
        """
        if not validate_8char_key(item_key):
            return None, None

        att = self.db.get_pdf_attachment_for_item(item_key)
        if not att:
            return None, None

        attach_key = att.get("attachmentKey", "")
        raw_path = att.get("path")
        pdf_path = self.resolve_pdf_path(attach_key, raw_path)
        return att, pdf_path

    async def resolve_pdf_for_item_async(self, item_key: str) -> Tuple[Optional[dict[str, Any]], Optional[Path]]:
        return await asyncio.to_thread(self.resolve_pdf_for_item, item_key)

    def extract_text(
        self,
        pdf_path: Path,
        start_page: int = 1,
        end_page: Optional[int] = None,
        max_chars: int = 30000,
    ) -> dict[str, Any]:
        return PDFExtractor.extract_text(
            pdf_path=pdf_path,
            start_page=start_page,
            end_page=end_page,
            max_chars=max_chars,
        )

    async def extract_text_async(
        self,
        pdf_path: Path,
        start_page: int = 1,
        end_page: Optional[int] = None,
        max_chars: int = 30000,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(
            self.extract_text,
            pdf_path=pdf_path,
            start_page=start_page,
            end_page=end_page,
            max_chars=max_chars,
        )

    def get_info(self, pdf_path: Path) -> dict[str, Any]:
        return PDFExtractor.get_info(pdf_path)

    async def get_info_async(self, pdf_path: Path) -> dict[str, Any]:
        return await asyncio.to_thread(self.get_info, pdf_path)
