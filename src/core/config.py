import os
import platform
from pathlib import Path
from pydantic import BaseModel

class ZoteroConfig(BaseModel):
    data_dir: Path
    app_dir: Path
    local_api_url: str = "http://127.0.0.1:23119"
    sqlite_path: Path
    storage_path: Path

def detect_data_dir() -> Path:
    """
    Intelligently detect Zotero data directory across platforms.
    Prioritizes environment variables, then standard paths, then known custom locations.
    """
    env_dir = os.environ.get("ZOTERO_DATA_DIR")
    if env_dir and Path(env_dir).exists():
        return Path(env_dir)

    home = Path.home()
    standard_data_dir = home / "Zotero"
    if standard_data_dir.exists():
        return standard_data_dir

    # Known custom paths on Windows
    custom_candidates = [
        Path(r"D:\Software\Tool\Zotero\zotero"),
        Path(r"C:\Software\Zotero\zotero"),
        home / "Documents" / "Zotero",
    ]
    for c in custom_candidates:
        if c.exists():
            return c

    # Fallback to standard directory
    return standard_data_dir

def detect_app_dir() -> Path:
    """
    Intelligently detect Zotero application directory / executable location.
    """
    env_app = os.environ.get("ZOTERO_APP_DIR")
    if env_app and Path(env_app).exists():
        return Path(env_app)

    system = platform.system()
    home = Path.home()

    if system == "Windows":
        candidates = [
            Path(r"C:\Program Files\Zotero"),
            Path(r"C:\Program Files (x86)\Zotero"),
            Path(r"D:\Software\Tool\Zotero"),
            home / "AppData" / "Local" / "Zotero",
        ]
    elif system == "Darwin":
        candidates = [
            Path("/Applications/Zotero.app"),
            home / "Applications" / "Zotero.app",
        ]
    else:  # Linux
        candidates = [
            Path("/usr/lib/zotero"),
            Path("/opt/zotero"),
            home / ".local" / "share" / "zotero",
        ]

    for c in candidates:
        if c.exists():
            return c

    return Path(r"C:\Program Files\Zotero") if system == "Windows" else Path("/Applications/Zotero.app")

def get_config() -> ZoteroConfig:
    data_dir = detect_data_dir()
    app_dir = detect_app_dir()

    return ZoteroConfig(
        data_dir=data_dir,
        app_dir=app_dir,
        local_api_url=os.environ.get("ZOTERO_LOCAL_API_URL", "http://127.0.0.1:23119"),
        sqlite_path=data_dir / "zotero.sqlite",
        storage_path=data_dir / "storage",
    )
