import re
from pathlib import Path
from typing import Optional
from .config import get_config

class StorageResolver:
    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = (storage_dir or get_config().storage_path).resolve()

    def resolve_pdf_path(self, attachment_key: str, raw_path: Optional[str] = None) -> Optional[Path]:
        # Strictly validate attachment key format (Zotero keys are 8-character alphanumeric)
        if not attachment_key or not re.match(r"^[A-Za-z0-9]{8}$", attachment_key):
            return None

        storage_root = self.storage_dir.resolve()
        folder = (self.storage_dir / attachment_key).resolve()

        # Strict defense against path traversal
        try:
            folder.relative_to(storage_root)
        except ValueError:
            return None

        if folder.exists() and folder.is_dir():
            # Check if filename in raw_path exists
            if raw_path and raw_path.startswith("storage:"):
                fname = raw_path[len("storage:"):].strip()
                cand = (folder / fname).resolve()
                try:
                    cand.relative_to(storage_root)
                    if cand.exists() and cand.is_file() and cand.suffix.lower() == ".pdf":
                        return cand
                except ValueError:
                    pass

            # Fallback: Find any .pdf file in this storage folder
            pdf_files = list(folder.glob("*.pdf"))
            if pdf_files:
                target_pdf = pdf_files[0].resolve()
                try:
                    target_pdf.relative_to(storage_root)
                    return target_pdf
                except ValueError:
                    return None

        # Architectural Design Note (Zotero Linked Files):
        # When users link external files into Zotero without copying them into the storage/ directory
        # (the native Zotero 'Attach Link to File' feature), the database stores an absolute file path.
        # This branch resolves such Linked Files only when raw_path comes strictly from
        # the read-only SQLite database (never accepted from web HTTP inputs), and verifies that the
        # target physically exists on disk and strictly carries a '.pdf' extension.
        # Note: Web endpoints (such as /api/pdf/{attachment_key}) never supply raw_path,
        # ensuring external web requests can never exploit or reach this branch.
        if raw_path and not raw_path.startswith("storage:"):
            abs_cand = Path(raw_path).resolve()
            if abs_cand.exists() and abs_cand.is_file() and abs_cand.suffix.lower() == ".pdf":
                return abs_cand

        return None
