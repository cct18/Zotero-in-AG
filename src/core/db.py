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
        'mode=ro' allows SQLite to read active WAL incremental updates in real-time.
        Features exponential backoff retry to handle transient lock contention during heavy Zotero writes.
        On Windows, if Zotero desktop holds an exclusive file lock (locking_mode=EXCLUSIVE),
        gracefully fall back to 'mode=ro&immutable=1' to completely bypass OS-level lock conflicts.
        """
        import time
        conn = None
        # 1. Try standard read-only WAL mode first
        uri_ro = f"{self.db_path.as_uri()}?mode=ro"
        for attempt in range(2):
            try:
                conn = sqlite3.connect(uri_ro, uri=True, timeout=0.6, isolation_level=None)
                conn.execute("PRAGMA busy_timeout = 600;")
                conn.row_factory = sqlite3.Row
                conn.execute("SELECT 1 FROM collections LIMIT 1;")
                break
            except sqlite3.OperationalError as e:
                if conn:
                    try:
                        conn.close()
                    except Exception:
                        pass
                    conn = None
                if "locked" in str(e).lower() and attempt < 1:
                    time.sleep(0.1)
                    continue
                break

        # 2. If locked by desktop Zotero on Windows, gracefully fall back to immutable=1
        if conn is None:
            uri_immutable = f"{self.db_path.as_uri()}?mode=ro&immutable=1"
            conn = sqlite3.connect(uri_immutable, uri=True, timeout=5.0, isolation_level=None)
            conn.row_factory = sqlite3.Row

        try:
            yield conn
        finally:
            if conn:
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
        order_by: str = "date_desc",
    ) -> list[dict[str, Any]]:
        # Allow regular literature items OR standalone PDF attachments
        where_clauses = [
            """(
                t.typeName NOT IN ('attachment', 'note', 'annotation')
                OR (t.typeName = 'attachment' AND ia_self.contentType = 'application/pdf' AND (ia_self.parentItemID IS NULL OR ia_self.parentItemID = 0))
            )""",
            "i.itemID NOT IN (SELECT itemID FROM deletedItems)",
        ]
        params: list[Any] = []

        joins = [
            "JOIN itemTypes t ON i.itemTypeID = t.itemTypeID",
            "LEFT JOIN itemAttachments ia_self ON i.itemID = ia_self.itemID AND ia_self.contentType = 'application/pdf'",
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
                OR (t.typeName = 'attachment' AND ia_self.path LIKE ?)
            )""")
            params.extend([q_str, q_str, q_str, q_str])

        where_sql = " AND ".join(where_clauses)
        join_sql = " ".join(joins)

        # Build order by clause
        if order_by == "date_asc":
            order_sql = "CASE WHEN date IS NULL OR date = '' THEN 1 ELSE 0 END, date ASC, i.dateModified ASC"
        elif order_by == "added_desc":
            order_sql = "i.dateAdded DESC"
        elif order_by == "added_asc":
            order_sql = "i.dateAdded ASC"
        elif order_by == "modified_asc":
            order_sql = "i.dateModified ASC"
        elif order_by == "modified_desc":
            order_sql = "i.dateModified DESC"
        else: # date_desc (default)
            order_sql = "CASE WHEN date IS NULL OR date = '' THEN 1 ELSE 0 END, date DESC, i.dateModified DESC"

        sql = f"""
            SELECT 
                i.itemID,
                i.key as itemKey,
                t.typeName as itemType,
                COALESCE(
                    (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'title' LIMIT 1),
                    CASE 
                        WHEN t.typeName = 'attachment' THEN 
                            COALESCE(
                                (SELECT REPLACE(ia_sub.path, 'storage:', '') FROM itemAttachments ia_sub WHERE ia_sub.itemID = i.itemID),
                                '未命名 PDF'
                            )
                        ELSE NULL 
                    END
                ) as title,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'date' LIMIT 1) as date,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'publicationTitle' LIMIT 1) as publication,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'abstractNote' LIMIT 1) as abstractNote,
                (SELECT v.value FROM itemData d JOIN itemDataValues v ON d.valueID = v.valueID JOIN fields f ON d.fieldID = f.fieldID WHERE d.itemID = i.itemID AND f.fieldName = 'DOI' LIMIT 1) as doi,
                COALESCE(
                    (
                        SELECT att_child.key 
                        FROM itemAttachments ia_child 
                        JOIN items att_child ON ia_child.itemID = att_child.itemID 
                        WHERE ia_child.parentItemID = i.itemID AND ia_child.contentType = 'application/pdf'
                        ORDER BY ia_child.itemID ASC LIMIT 1
                    ),
                    CASE WHEN t.typeName = 'attachment' THEN i.key ELSE NULL END
                ) as pdfAttachmentKey,
                COALESCE(
                    (
                        SELECT ia_child.path 
                        FROM itemAttachments ia_child 
                        WHERE ia_child.parentItemID = i.itemID AND ia_child.contentType = 'application/pdf'
                        ORDER BY ia_child.itemID ASC LIMIT 1
                    ),
                    ia_self.path
                ) as pdfPath,
                i.dateAdded,
                i.dateModified
            FROM items i
            {join_sql}
            WHERE {where_sql}
            GROUP BY i.itemID
            ORDER BY {order_sql}
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
                ORDER BY ia.itemID ASC
            """, (item_id,))
            item["pdfAttachments"] = [dict(r) for r in cur.fetchall()]

            # If this is a standalone attachment itself, populate pdfAttachments directly
            if item.get("itemType") == "attachment":
                cur.execute("""
                    SELECT i.key as attachmentKey, ia.contentType, ia.path
                    FROM itemAttachments ia
                    JOIN items i ON ia.itemID = i.itemID
                    WHERE ia.itemID = ? AND ia.contentType = 'application/pdf'
                """, (item_id,))
                self_att = cur.fetchone()
                if self_att:
                    att_dict = dict(self_att)
                    item["pdfAttachments"] = [att_dict]
                    if not item.get("title") and att_dict.get("path"):
                        item["title"] = att_dict["path"].replace("storage:", "").strip()

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
            # 1. Try finding child attachment under parent item
            cur.execute("""
                SELECT 
                    att_item.key as attachmentKey, 
                    ia.path,
                    ia.contentType
                FROM items i
                JOIN itemAttachments ia ON i.itemID = ia.parentItemID
                JOIN items att_item ON ia.itemID = att_item.itemID
                WHERE i.key = ? AND ia.contentType = 'application/pdf'
                ORDER BY ia.itemID ASC
                LIMIT 1
            """, (item_key,))
            r = cur.fetchone()
            if r:
                return dict(r)

            # 2. Try checking if item_key is a standalone attachment itself
            cur.execute("""
                SELECT 
                    i.key as attachmentKey,
                    ia.path,
                    ia.contentType
                FROM items i
                JOIN itemAttachments ia ON i.itemID = ia.itemID
                WHERE i.key = ? AND ia.contentType = 'application/pdf'
                ORDER BY ia.itemID ASC
                LIMIT 1
            """, (item_key,))
            r2 = cur.fetchone()
            if r2:
                return dict(r2)

            return None

    def get_tags(self) -> list[str]:
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT name FROM tags ORDER BY name ASC")
            return [r["name"] for r in cur.fetchall()]

    def get_annotations_for_item(self, item_key: str) -> list[dict[str, Any]]:
        """
        Retrieves PDF annotations (highlights, underlines, notes) stored in Zotero's itemAnnotations table.
        """
        with self._get_connection() as conn:
            cur = conn.cursor()
            cur.execute("SELECT itemID, itemTypeID FROM items WHERE key = ?", (item_key,))
            base = cur.fetchone()
            if not base:
                return []
            item_id = base["itemID"]

            cur.execute("""
                SELECT 
                    a.itemID as annotationId,
                    a.type as annotationType,
                    a.color,
                    a.text,
                    a.comment,
                    a.pageLabel,
                    a.sortIndex,
                    a.position,
                    att_item.key as attachmentKey
                FROM itemAnnotations a
                JOIN items att_item ON a.parentItemID = att_item.itemID
                WHERE a.parentItemID IN (
                    SELECT itemID FROM itemAttachments WHERE parentItemID = ?
                    UNION
                    SELECT ?
                )
                ORDER BY a.sortIndex ASC
            """, (item_id, item_id))
            return [dict(r) for r in cur.fetchall()]
