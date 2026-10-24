import json
from typing import Any, Optional
import httpx
from .config import get_config

class ZoteroAPIClient:
    def __init__(self, base_url: Optional[str] = None):
        self.base_url = (base_url or get_config().local_api_url).rstrip("/")

    def _get_client(self, timeout: float = 3.0) -> httpx.Client:
        # trust_env=False avoids proxy issues on localhost
        return httpx.Client(trust_env=False, timeout=timeout)

    def is_running(self) -> bool:
        try:
            with self._get_client(timeout=1.5) as client:
                resp = client.get(f"{self.base_url}/connector/ping")
                return resp.status_code == 200
        except Exception:
            return False

    def create_item_note(
        self,
        parent_item_key: Optional[str],
        note_title: str,
        note_markdown: str,
        tags: Optional[list[str]] = None,
        collection_keys: Optional[list[str]] = None,
    ) -> dict[str, Any]:
        """
        Creates a note via Zotero 7/10 Local API.
        - For regular literature items: attached under parent_item_key.
        - For standalone PDFs (no parent item): created directly inside the collection (目录) or root library.
        """
        if not self.is_running():
            return {
                "success": False,
                "error": "Zotero 桌面端当前未运行。为了保证数据库安全与实时同步，请先启动 Zotero 10 客户端。",
            }

        # Convert simple markdown to clean HTML for Zotero notes
        html_content = self._markdown_to_zotero_html(note_title, note_markdown)

        # Check if parent_item_key is a standalone attachment (has no parent)
        is_standalone = False
        target_collections = list(collection_keys) if collection_keys else []
        if parent_item_key:
            try:
                from .db import ZoteroDB
                item = ZoteroDB().get_item_by_key(parent_item_key)
                if item and item.get("itemType") == "attachment":
                    is_standalone = True
                    if not target_collections and item.get("collections"):
                        target_collections = [c["key"] for c in item["collections"] if "key" in c]
            except Exception:
                pass

        note_item: dict[str, Any] = {
            "itemType": "note",
            "note": html_content,
            "tags": [{"tag": t} for t in (tags or ["agent-note", "antigravity"])],
        }

        if is_standalone:
            if target_collections:
                note_item["collections"] = target_collections
            success_msg = f"成功在目录 [{', '.join(target_collections) or '根目录'}] 中为独立文档 [{parent_item_key}] 创建独立精读笔记！"
        else:
            note_item["parentItem"] = parent_item_key
            success_msg = f"成功为文献 [{parent_item_key}] 创建独立精读笔记！"

        payload = [note_item]

        try:
            with self._get_client(timeout=5.0) as client:
                resp = client.post(
                    f"{self.base_url}/api/users/0/items",
                    headers={"Content-Type": "application/json"},
                    content=json.dumps(payload),
                )
                if resp.status_code in (200, 201):
                    return {
                        "success": True,
                        "data": resp.json() if resp.text else {},
                        "message": success_msg,
                    }
                else:
                    return {
                        "success": False,
                        "status_code": resp.status_code,
                        "error": resp.text or f"HTTP {resp.status_code}",
                    }
        except Exception as e:
            return {
                "success": False,
                "error": f"调用 Zotero 本地接口失败: {str(e)}",
            }

    def add_tags_to_item(self, item_key: str, tags: list[str]) -> dict[str, Any]:
        if not self.is_running():
            return {
                "success": False,
                "error": "Zotero 桌面端当前未运行，请先启动 Zotero 10。",
            }

        payload = [{"tag": t} for t in tags]
        try:
            with self._get_client(timeout=5.0) as client:
                resp = client.post(
                    f"{self.base_url}/api/users/0/items/{item_key}/tags",
                    headers={"Content-Type": "application/json"},
                    content=json.dumps(payload),
                )
                if resp.status_code in (200, 201, 204):
                    return {"success": True, "message": f"成功为 [{item_key}] 添加标签: {tags}"}
                return {"success": False, "error": resp.text}
        except Exception as e:
            return {"success": False, "error": str(e)}

    @staticmethod
    def _open_protocol_uri(uri: str) -> None:
        import platform
        import subprocess
        sys_name = platform.system()
        if sys_name == "Windows":
            import os
            os.startfile(uri)
        elif sys_name == "Darwin":
            subprocess.Popen(["open", uri])
        else:
            subprocess.Popen(["xdg-open", uri])

    def locate_item_in_zotero(self, item_key: str) -> dict[str, Any]:
        """
        Locates and highlights an item in Zotero desktop via OS protocol or direct binary invocation.
        Avoids the cold-boot race condition by ensuring Zotero is responsive before selecting.
        """
        uri = f"zotero://select/library/items/{item_key}"
        import platform
        import subprocess
        import time

        # Case 1: Zotero is already running
        if self.is_running():
            try:
                self._open_protocol_uri(uri)
                return {"success": True, "message": f"已在 Zotero 中定位并聚焦文献 [{item_key}]"}
            except Exception as e:
                return {"success": False, "error": f"定位失败: {str(e)}"}

        # Case 2: Zotero is closed -> launch cleanly with proper cwd to avoid hang
        app_dir = get_config().app_dir
        sys_name = platform.system()
        if sys_name == "Windows":
            exe = app_dir / "zotero.exe"
            if not exe.exists():
                exe = app_dir / "Zotero.exe"
        elif sys_name == "Darwin":
            exe = app_dir / "Contents" / "MacOS" / "zotero"
        else:
            exe = app_dir / "zotero"

        try:
            if sys_name == "Darwin" and app_dir.suffix == ".app":
                subprocess.Popen(["open", "-a", str(app_dir)])
            elif exe.exists():
                subprocess.Popen([str(exe)], cwd=str(exe.parent))
            else:
                self._open_protocol_uri(uri)
                return {"success": True, "message": f"已尝试通过系统协议调起 Zotero [{item_key}]"}
        except Exception as e:
            return {"success": False, "error": f"启动 Zotero 失败: {str(e)}"}

        # Wait up to 6 seconds for Zotero to finish initialization
        for _ in range(12):
            time.sleep(0.5)
            if self.is_running():
                break

        # Now dispatch the selection safely
        try:
            self._open_protocol_uri(uri)
            return {"success": True, "message": f"已成功启动 Zotero 10 并定位文献 [{item_key}]"}
        except Exception:
            return {"success": True, "message": "已成功启动 Zotero 10 客户端"}

    @staticmethod
    def _markdown_to_zotero_html(title: str, markdown: str) -> str:
        # Generate clean HTML note readable in Zotero Note Editor
        # Zotero notes use rich text HTML
        lines = markdown.split("\n")
        html_lines = []
        if title:
            html_lines.append(f"<h2>{title}</h2>")
            html_lines.append("<p><em>Generated by Antigravity Agent</em></p><hr/>")

        in_list = False
        for line in lines:
            sline = line.strip()
            if not sline:
                if in_list:
                    html_lines.append("</ul>")
                    in_list = False
                continue
            if sline.startswith("### "):
                if in_list:
                    html_lines.append("</ul>")
                    in_list = False
                html_lines.append(f"<h4>{sline[4:]}</h4>")
            elif sline.startswith("## "):
                if in_list:
                    html_lines.append("</ul>")
                    in_list = False
                html_lines.append(f"<h3>{sline[3:]}</h3>")
            elif sline.startswith("# "):
                if in_list:
                    html_lines.append("</ul>")
                    in_list = False
                html_lines.append(f"<h2>{sline[2:]}</h2>")
            elif sline.startswith("- ") or sline.startswith("* "):
                if not in_list:
                    html_lines.append("<ul>")
                    in_list = True
                html_lines.append(f"<li>{sline[2:]}</li>")
            else:
                if in_list:
                    html_lines.append("</ul>")
                    in_list = False
                html_lines.append(f"<p>{sline}</p>")

        if in_list:
            html_lines.append("</ul>")

        return "\n".join(html_lines)
