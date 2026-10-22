import sqlite3
from pathlib import Path
from typing import Any, Optional
from contextlib import contextmanager
from .config import get_config

class ZoteroDB:
    def __init__(self, db_path: Optional[Path] = None):
        if db_path is None:
            self.db_path = get_config().sqlite_path
        else:
            self.db_path = db_path

    @contextmanager
    def _get_connection(self):
        """
        Open a strictly read-only, non-locking connection to zotero.sqlite.
        'mode=ro&immutable=1' guarantees that SQLite never acquires file locks
        or blocks the Zotero desktop application from starting or writing!
        """
        uri = f"{self.db_path.as_uri()}?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
        finally:
            conn.close()

    def get_collections_tree(self) -> list[dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT collectionID, collectionName, parentCollectionID, key
                FROM collections
                ORDER BY collectionName ASC
            """)
            rows = [dict(r) for r in cur.fetchall()]

        # Build hierarchical tree
        by_id: dict[int, dict[str, Any]] = {}
        for r in rows:
            by_id[r["collectionID"]] = {
                "id": r["collectionID"],
                "key": r["key"],
                "name": r["collectionName"],
                "parent_id": r["parentCollectionID"],
                "children": [],
            }

        tree: list[dict[str, Any]] = []
        for r in rows:
            cid = r["collectionID"]
            node = by_id[cid]
            pid = r["parentCollectionID"]
            if pid and pid in by_id:
                by_id[pid]["children"].append(node)
            else:
                tree.append(node)
        return tree

    def get_items(
        self,
        collection_key: Optional[str] = None,
        query: Optional[str] = None,
        tag: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        where_clauses = [
            "t.typeName NOT IN ('attachment', 'note', 'annotation')",
            "i.itemID NOT IN (SELECT itemID FROM deletedItems)",
        ]
        params: list[Any] = []

        joins = [
            "JOIN itemTypes t ON i.itemTypeID = t.itemTypeID",
            "LEFT JOIN itemAttachments ia ON i.itemID = ia.parentItemID AND ia.contentType = 'application/pdf'",
            "LEFT JOIN items att_item ON ia.itemID = att_item.itemID",
        ]

        if collection_key:
            joins.append("JOIN collectionItems ci ON i.itemID = ci.itemID")
            joins.append("JOIN collections c ON ci.collectionID = c.collectionID")
            where_clauses.append("c.key = ?")
            params.append(collection_key)

        if tag:
            joins.append("JOIN itemTags it ON i.itemID = it.itemID")
            joins.append("JOIN tags tg ON it.tagID = tg.tagID")
            where_clauses.append("tg.name = ?")
            params.append(tag)

        if query and query.strip():
            q_str = f"%{query.strip()}%"
            where_clauses.append("""(
                EXISTS (
                    SELECT 1 FROM itemData d 
                    JOIN itemDataValues v ON d.valueID = v.valueID 
                    WHERE d.itemID = i.itemID AND v.value LIKE ?
                )
                OR EXISTS (
                    SELECT 1 FROM itemCreators ic
                    JOIN creators cr ON ic.creatorID = cr.creatorID
                    WHERE ic.itemID = i.itemID AND (cr.firstName LIKE ? OR cr.lastName LIKE ?)
                )
            )""")
            params.extend([q_str, q_str, q_str])

        where_sql = " AND ".join(where_clauses)
        join_sql = " ".join(joins)

        sql = f"""
            SELECT 
                i.itemID,
                i.key as itemKey,
                t.typeName as itemType,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'title' LIMIT 1) as title,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'date' LIMIT 1) as date,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'publicationTitle' LIMIT 1) as publication,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'abstractNote' LIMIT 1) as abstractNote,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'DOI' LIMIT 1) as doi,
                att_item.key as pdfAttachmentKey,
                ia.path as pdfPath
            FROM items i
            {join_sql}
            WHERE {where_sql}
            GROUP BY i.itemID
            ORDER BY i.dateModified DESC
            LIMIT ? OFFSET ?
        """
        params.extend([limit, offset])

        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute(sql, params)
            items = [dict(r) for r in cur.fetchall()]

            if items:
                item_ids = [item["itemID"] for item in items]
                placeholders = ",".join("?" * len(item_ids))
                cur.execute(f"""
                    SELECT ic.itemID, c.firstName, c.lastName
                    FROM itemCreators ic
                    JOIN creators c ON ic.creatorID = c.creatorID
                    WHERE ic.itemID IN ({placeholders})
                    ORDER BY ic.orderIndex ASC
                """, item_ids)
                creators_by_item: dict[int, list[str]] = {}
                for row in cur.fetchall():
                    name = f"{row['firstName'] or ''} {row['lastName'] or ''}".strip()
                    creators_by_item.setdefault(row["itemID"], []).append(name)

                for item in items:
                    item["creators"] = creators_by_item.get(item["itemID"], [])
                    item["hasPdf"] = bool(item.get("pdfAttachmentKey"))

        return items

    def get_item_by_key(self, item_key: str) -> Optional[dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT i.itemID, i.key as itemKey, t.typeName as itemType, i.dateAdded, i.dateModified
                FROM items i
                JOIN itemTypes t ON i.itemTypeID = t.itemTypeID
                WHERE i.key = ?
            """, (item_key,))
            base = cur.fetchone()
            if not base:
                return None

            item = dict(base)
            item_id = item["itemID"]

            cur.execute("""
                SELECT f.fieldName, v.value
                FROM itemData d
                JOIN fields f ON d.fieldID = f.fieldID
                JOIN itemDataValues v ON d.valueID = v.valueID
                WHERE d.itemID = ?
            """, (item_id,))
            for r in cur.fetchall():
                item[r["fieldName"]] = r["value"]

            cur.execute("""
                SELECT c.firstName, c.lastName
                FROM itemCreators ic
                JOIN creators c ON ic.creatorID = c.creatorID
                WHERE ic.itemID = ?
                ORDER BY ic.orderIndex ASC
            """, (item_id,))
            item["creators"] = [
                f"{r['firstName'] or ''} {r['lastName'] or ''}".strip()
                for r in cur.fetchall()
            ]

            cur.execute("""
                SELECT c.key, c.collectionName
                FROM collectionItems ci
                JOIN collections c ON ci.collectionID = c.collectionID
                WHERE ci.itemID = ?
            """, (item_id,))
            item["collections"] = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT t.name
                FROM itemTags it
                JOIN tags t ON it.tagID = t.tagID
                WHERE it.itemID = ?
            """, (item_id,))
            item["tags"] = [r["name"] for r in cur.fetchall()]

            cur.execute("""
                SELECT att_item.key as attachmentKey, ia.contentType, ia.path
                FROM itemAttachments ia
                JOIN items att_item ON ia.itemID = att_item.itemID
                WHERE ia.parentItemID = ? AND ia.contentType = 'application/pdf'
            """, (item_id,))
            item["pdfAttachments"] = [dict(r) for r in cur.fetchall()]

            cur.execute("""
                SELECT n.title, n.note, note_item.key as noteKey
                FROM itemNotes n
                JOIN items note_item ON n.itemID = note_item.itemID
                WHERE n.parentItemID = ?
            """, (item_id,))
            item["notes"] = [dict(r) for r in cur.fetchall()]

            return item

    def get_pdf_attachment_for_item(self, item_key: str) -> Optional[dict[str, Any]]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    att_item.key as attachmentKey, 
                    ia.path,
                    ia.contentType
                FROM items i
                JOIN itemAttachments ia ON i.itemID = ia.parentItemID
                JOIN items att_item ON ia.itemID = att_item.itemID
                WHERE i.key = ? AND ia.contentType = 'application/pdf'
                LIMIT 1
            """, (item_key,))
            r = cur.fetchone()
            if not r:
                return None
            return dict(r)

    def get_tags(self) -> list[str]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT name FROM tags ORDER BY name ASC")
            return [r["name"] for r in cur.fetchall()]
