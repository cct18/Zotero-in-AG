from pathlib import Path
from typing import Optional
from .config import get_config

class StorageResolver:
    def __init__(self, storage_dir: Optional[Path] = None):
        self.storage_dir = storage_dir or get_config().storage_path

    def resolve_pdf_path(self, attachment_key: str, raw_path: Optional[str] = None) -> Optional[Path]:
        if not attachment_key:
            return None

        folder = self.storage_dir / attachment_key
        if folder.exists() and folder.is_dir():
            # Check if filename in raw_path exists
            if raw_path and raw_path.startswith("storage:"):
                fname = raw_path[len("storage:"):].strip()
                cand = folder / fname
                if cand.exists() and cand.is_file():
                    return cand

            # Fallback: Find any .pdf file in this storage folder
            pdf_files = list(folder.glob("*.pdf"))
            if pdf_files:
                return pdf_files[0]

        # Check if raw_path is an absolute path
        if raw_path and not raw_path.startswith("storage:"):
            abs_cand = Path(raw_path)
            if abs_cand.exists() and abs_cand.is_file():
                return abs_cand

        return None
