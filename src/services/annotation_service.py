import os
import json
import asyncio
import tempfile
import logging
from pathlib import Path
from typing import Any, Optional

from src.domain.models import Annotation, AnnotationCreateRequest
from src.core.db import ZoteroDB

logger = logging.getLogger(__name__)

class AnnotationService:
    def __init__(self, db: Optional[ZoteroDB] = None):
        self.db = db or ZoteroDB()
        self._cache_lock = asyncio.Lock()

    def _get_cache_file(self) -> Path:
        env_cache = os.environ.get("ZOTERO_IN_AG_CACHE_FILE")
        if env_cache:
            return Path(env_cache)
        gemini_dir = Path.home() / ".gemini" / "antigravity"
        if gemini_dir.exists():
            return gemini_dir / "zotero_annotations_cache.json"
        return Path.home() / ".zotero_in_ag_annotations.json"

    def _load_cached_unlocked(self) -> dict[str, list[dict]]:
        cache_file = self._get_cache_file()
        if cache_file.exists():
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception as e:
                logger.warning(f"Failed to read annotations cache: {e}")
                return {}
        return {}

    def _save_cached_unlocked(self, data: dict[str, list[dict]]) -> bool:
        cache_file = self._get_cache_file()
        try:
            cache_file.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", dir=str(cache_file.parent), delete=False, encoding="utf-8") as tf:
                json.dump(data, tf, ensure_ascii=False, indent=2)
                temp_name = tf.name
            os.replace(temp_name, cache_file)
            return True
        except Exception as e:
            logger.error(f"Failed to persist annotations cache to {cache_file}: {e}")
            return False

    async def get_annotations_for_item(self, item_key: str) -> dict[str, Any]:
        """
        Retrieves, normalizes, and merges both Zotero SQLite annotations and local annotations.
        Returns:
            - annotations: Unified list[Annotation] (Pydantic models)
            - zotero_annotations: Raw list (retained for backward compatibility)
            - local_annotations: Raw list (retained for backward compatibility)
        """
        # 1. Fetch native Zotero SQLite annotations
        zotero_list: list[dict[str, Any]] = []
        try:
            raw_db = await asyncio.to_thread(self.db.get_annotations_for_item, item_key)
            for a in raw_db:
                pos = {}
                if a.get("position"):
                    try:
                        pos = json.loads(a["position"])
                    except Exception:
                        pass
                zotero_list.append({
                    "id": f"zotero_{a['annotationId']}",
                    "source": "zotero",
                    "annotationType": a.get("annotationType", 1), # 1=highlight, 3=underline
                    "color": a.get("color") or "#ffd400",
                    "text": a.get("text") or "",
                    "comment": a.get("comment") or "",
                    "pageLabel": a.get("pageLabel"),
                    "position": pos,
                    "pageIndex": pos.get("pageIndex", 0),
                    "rects": pos.get("rects", []),
                })
        except Exception as e:
            logger.warning(f"Failed to fetch SQLite annotations for {item_key}: {e}")

        # 2. Fetch local annotations under lock
        async with self._cache_lock:
            local_list = self._load_cached_unlocked().get(item_key, [])

        # 3. Server-side unified merge into Annotation models
        unified: list[Annotation] = []
        for z in zotero_list:
            try:
                unified.append(Annotation(**z))
            except Exception:
                pass

        for l in local_list:
            try:
                ann_dict = dict(l)
                ann_dict["source"] = "local"
                ann_dict.setdefault("pageIndex", max(0, ann_dict.get("pageNum", 1) - 1))
                unified.append(Annotation(**ann_dict))
            except Exception:
                pass

        return {
            "success": True,
            "item_key": item_key,
            "annotations": [u.model_dump() for u in unified],
            "zotero_annotations": zotero_list,
            "local_annotations": local_list,
        }

    async def save_annotation(self, item_key: str, ann: AnnotationCreateRequest) -> dict[str, Any]:
        """
        Atomically saves or updates an annotation in local cache under mutex lock.
        """
        ann_dict = ann.model_dump()
        async with self._cache_lock:
            all_cached = self._load_cached_unlocked()
            item_list = all_cached.setdefault(item_key, [])
            idx = next((i for i, x in enumerate(item_list) if x.get("id") == ann.id), -1)
            if idx >= 0:
                item_list[idx] = ann_dict
            else:
                item_list.append(ann_dict)
            self._save_cached_unlocked(all_cached)

        return {"success": True, "annotation": ann_dict}

    async def delete_annotation(self, item_key: str, annotation_id: str) -> dict[str, Any]:
        """
        Atomically deletes an annotation from local cache under mutex lock.
        Rejects attempts to delete native Zotero read-only SQLite annotations.
        """
        if annotation_id.startswith("zotero_"):
            return {
                "success": False,
                "error": "Zotero 原生批注为只读，无法在侧边栏直接删除，请在桌面端操作",
            }

        async with self._cache_lock:
            all_cached = self._load_cached_unlocked()
            if item_key in all_cached:
                all_cached[item_key] = [x for x in all_cached[item_key] if x.get("id") != annotation_id]
                self._save_cached_unlocked(all_cached)

        return {"success": True}
