import os
import re
import platform
from pathlib import Path
from typing import Optional
from pydantic import BaseModel

class ZoteroConfig(BaseModel):
    data_dir: Path
    app_dir: Path
    local_api_url: str = "http://127.0.0.1:23119"
    sqlite_path: Path
    storage_path: Path

def _detect_data_dir_from_prefs() -> Optional[Path]:
    """
    Dynamically detect custom Zotero data directory configured in Zotero's prefs.js.
    Works for any user who changed their storage/data location in Zotero preferences.
    """
    system = platform.system()
    home = Path.home()
    profile_dirs = []

    if system == "Windows":
        app_data = os.environ.get("APPDATA")
        if app_data:
            profile_dirs.append(Path(app_data) / "Zotero" / "Zotero" / "Profiles")
    elif system == "Darwin":
        profile_dirs.append(home / "Library" / "Application Support" / "Zotero" / "Profiles")
    else:  # Linux
        profile_dirs.append(home / ".zotero" / "zotero")

    for p_dir in profile_dirs:
        if p_dir.exists() and p_dir.is_dir():
            for prefs_file in p_dir.glob("*/prefs.js"):
                try:
                    content = prefs_file.read_text(encoding="utf-8", errors="ignore")
                    m = re.search(r'user_pref\(\s*["\']extensions\.zotero\.dataDir["\']\s*,\s*["\'](.*?)["\']\s*\)', content)
                    if m:
                        raw_dir = m.group(1).replace("\\\\", "\\")
                        cand = Path(raw_dir)
                        if cand.exists():
                            return cand
                except Exception:
                    continue
    return None

def _detect_app_dir_from_registry() -> Optional[Path]:
    """
    On Windows, dynamically detect Zotero installation directory from the OS protocol registry.
    """
    if platform.system() != "Windows":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CLASSES_ROOT, r"zotero\shell\open\command") as key:
            val, _ = winreg.QueryValueEx(key, "")
            m = re.match(r'^\s*"?([^"]+?[/\\]zotero\.exe)"?', val, re.IGNORECASE)
            if m:
                exe_path = Path(m.group(1))
                if exe_path.exists():
                    return exe_path.parent
    except Exception:
        pass
    return None

def detect_data_dir() -> Path:
    """
    Intelligently detect Zotero data directory across platforms without hardcoded machine paths.
    Prioritizes environment variable, then standard ~/Zotero, then Zotero prefs.js, then ~/Documents/Zotero.
    """
    env_dir = os.environ.get("ZOTERO_DATA_DIR")
    if env_dir and Path(env_dir).exists():
        return Path(env_dir)

    home = Path.home()
    standard_data_dir = home / "Zotero"
    if standard_data_dir.exists():
        return standard_data_dir

    # Detect dynamically from Zotero profile prefs.js
    prefs_dir = _detect_data_dir_from_prefs()
    if prefs_dir:
        return prefs_dir

    # Standard documents candidate
    doc_cand = home / "Documents" / "Zotero"
    if doc_cand.exists():
        return doc_cand

    return standard_data_dir

def detect_app_dir() -> Path:
    """
    Intelligently detect Zotero application directory / executable location.
    Prioritizes environment variable, then registry/protocol, then standard directories.
    """
    env_app = os.environ.get("ZOTERO_APP_DIR")
    if env_app and Path(env_app).exists():
        return Path(env_app)

    reg_app = _detect_app_dir_from_registry()
    if reg_app:
        return reg_app

    system = platform.system()
    home = Path.home()

    if system == "Windows":
        candidates = [
            Path(r"C:\Program Files\Zotero"),
            Path(r"C:\Program Files (x86)\Zotero"),
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
            Path("/usr/bin/zotero"),
            Path("/opt/zotero"),
            home / ".local" / "share" / "zotero",
        ]

    for c in candidates:
        if c.exists():
            return c

    if system == "Windows":
        return Path(r"C:\Program Files\Zotero")
    elif system == "Darwin":
        return Path("/Applications/Zotero.app")
    else:
        return Path("/usr/bin/zotero")

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
