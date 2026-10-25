import sqlite3
import tempfile
import shutil
from pathlib import Path
from typing import Generator, Optional

MOCK_SCHEMA_SQL = """
CREATE TABLE itemTypes (
    itemTypeID INTEGER PRIMARY KEY,
    typeName TEXT NOT NULL
);

CREATE TABLE fields (
    fieldID INTEGER PRIMARY KEY,
    fieldName TEXT NOT NULL
);

CREATE TABLE items (
    itemID INTEGER PRIMARY KEY AUTOINCREMENT,
    itemTypeID INTEGER NOT NULL,
    key TEXT NOT NULL UNIQUE,
    dateAdded TEXT NOT NULL,
    dateModified TEXT NOT NULL,
    clientDateModified TEXT
);

CREATE TABLE itemDataValues (
    valueID INTEGER PRIMARY KEY AUTOINCREMENT,
    value TEXT NOT NULL
);

CREATE TABLE itemData (
    itemID INTEGER NOT NULL,
    fieldID INTEGER NOT NULL,
    valueID INTEGER NOT NULL,
    PRIMARY KEY (itemID, fieldID)
);

CREATE TABLE creators (
    creatorID INTEGER PRIMARY KEY AUTOINCREMENT,
    firstName TEXT,
    lastName TEXT
);

CREATE TABLE itemCreators (
    itemID INTEGER NOT NULL,
    creatorID INTEGER NOT NULL,
    creatorTypeID INTEGER NOT NULL DEFAULT 1,
    orderIndex INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (itemID, creatorID, orderIndex)
);

CREATE TABLE collections (
    collectionID INTEGER PRIMARY KEY AUTOINCREMENT,
    collectionName TEXT NOT NULL,
    parentCollectionID INTEGER,
    key TEXT NOT NULL UNIQUE,
    dateAdded TEXT,
    dateModified TEXT
);

CREATE TABLE collectionItems (
    collectionID INTEGER NOT NULL,
    itemID INTEGER NOT NULL,
    PRIMARY KEY (collectionID, itemID)
);

CREATE TABLE itemAttachments (
    itemID INTEGER PRIMARY KEY,
    parentItemID INTEGER,
    contentType TEXT,
    path TEXT,
    linkMode INTEGER DEFAULT 0
);

CREATE TABLE itemNotes (
    itemID INTEGER PRIMARY KEY,
    parentItemID INTEGER,
    note TEXT,
    title TEXT
);

CREATE TABLE itemAnnotations (
    itemID INTEGER PRIMARY KEY,
    parentItemID INTEGER,
    type INTEGER,
    authorName TEXT,
    text TEXT,
    comment TEXT,
    color TEXT,
    pageLabel TEXT,
    position TEXT,
    sortIndex TEXT
);

CREATE TABLE tags (
    tagID INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE
);

CREATE TABLE itemTags (
    itemID INTEGER NOT NULL,
    tagID INTEGER NOT NULL,
    type INTEGER DEFAULT 0,
    PRIMARY KEY (itemID, tagID)
);

CREATE TABLE deletedItems (
    itemID INTEGER PRIMARY KEY,
    dateDeleted TEXT
);
"""

def create_mock_zotero_dir(target_dir: Path) -> Path:
    """
    Populate a directory with a minimal valid Zotero SQLite database and sample storage/ PDFs.
    """
    db_file = target_dir / "zotero.sqlite"
    storage_dir = target_dir / "storage"
    storage_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_file))
    cur = conn.cursor()
    cur.executescript(MOCK_SCHEMA_SQL)

    # 1. Populate item types
    cur.executemany("INSERT INTO itemTypes (itemTypeID, typeName) VALUES (?, ?)", [
        (1, "journalArticle"),
        (2, "book"),
        (3, "attachment"),
        (4, "note"),
    ])

    # 2. Populate fields
    field_mapping = {
        1: "title",
        2: "date",
        3: "publicationTitle",
        4: "abstractNote",
        5: "DOI",
        6: "url",
    }
    cur.executemany("INSERT INTO fields (fieldID, fieldName) VALUES (?, ?)", list(field_mapping.items()))

    # 3. Populate collections (Root + Child)
    cur.execute("INSERT INTO collections (collectionID, collectionName, parentCollectionID, key) VALUES (1, 'Deep Learning', NULL, 'COLLROOT')")
    cur.execute("INSERT INTO collections (collectionID, collectionName, parentCollectionID, key) VALUES (2, 'Attention Mechanisms', 1, 'COLLSUB1')")

    # 4. Insert Item 1: Attention is All You Need
    cur.execute("INSERT INTO items (itemID, itemTypeID, key, dateAdded, dateModified) VALUES (1, 1, 'ATTNKEY1', '2023-01-01 10:00:00', '2023-01-02 12:00:00')")
    cur.execute("INSERT INTO collectionItems (collectionID, itemID) VALUES (2, 1)")

    # Metadata for Item 1
    def add_field_value(item_id: int, field_id: int, val: str):
        cur.execute("INSERT INTO itemDataValues (value) VALUES (?)", (val,))
        vid = cur.lastrowid
        cur.execute("INSERT INTO itemData (itemID, fieldID, valueID) VALUES (?, ?, ?)", (item_id, field_id, vid))

    add_field_value(1, 1, "Attention Is All You Need")
    add_field_value(1, 2, "2017")
    add_field_value(1, 3, "NeurIPS")
    add_field_value(1, 4, "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks.")
    add_field_value(1, 5, "10.5555/3295222.3295349")
    add_field_value(1, 6, "https://arxiv.org/abs/1706.03762")

    # Creators for Item 1
    cur.execute("INSERT INTO creators (creatorID, firstName, lastName) VALUES (1, 'Ashish', 'Vaswani')")
    cur.execute("INSERT INTO creators (creatorID, firstName, lastName) VALUES (2, 'Noam', 'Shazeer')")
    cur.execute("INSERT INTO itemCreators (itemID, creatorID, orderIndex) VALUES (1, 1, 0)")
    cur.execute("INSERT INTO itemCreators (itemID, creatorID, orderIndex) VALUES (1, 2, 1)")

    # Tags for Item 1
    cur.execute("INSERT INTO tags (tagID, name) VALUES (1, 'transformer')")
    cur.execute("INSERT INTO tags (tagID, name) VALUES (2, 'deep-learning')")
    cur.execute("INSERT INTO itemTags (itemID, tagID) VALUES (1, 1)")
    cur.execute("INSERT INTO itemTags (itemID, tagID) VALUES (1, 2)")

    # Child Attachment for Item 1
    cur.execute("INSERT INTO items (itemID, itemTypeID, key, dateAdded, dateModified) VALUES (2, 3, 'ATTACH01', '2023-01-01 10:00:00', '2023-01-02 12:00:00')")
    cur.execute("INSERT INTO itemAttachments (itemID, parentItemID, contentType, path) VALUES (2, 1, 'application/pdf', 'storage:Vaswani - 2017 - Attention Is All You Need.pdf')")

    # Item 2: Standalone Attachment PDF
    cur.execute("INSERT INTO items (itemID, itemTypeID, key, dateAdded, dateModified) VALUES (3, 3, 'STANDPDF', '2023-01-03 10:00:00', '2023-01-03 12:00:00')")
    cur.execute("INSERT INTO itemAttachments (itemID, parentItemID, contentType, path) VALUES (3, 0, 'application/pdf', 'storage:manual_guide.pdf')")

    # Native Zotero Annotation for Item 1 Attachment
    cur.execute("""
        INSERT INTO itemAnnotations (itemID, parentItemID, type, text, comment, color, pageLabel, position)
        VALUES (4, 2, 1, 'self-attention mechanism', 'Key innovation', '#ffd400', '1', '{"pageIndex":0,"rects":[{"left":10,"top":20,"width":100,"height":15}]}')
    """)

    conn.commit()
    conn.close()

    # Create dummy PDF file for ATTACH01 with valid readable text content
    attach_folder = storage_dir / "ATTACH01"
    attach_folder.mkdir(parents=True, exist_ok=True)
    pdf_file = attach_folder / "Vaswani - 2017 - Attention Is All You Need.pdf"
    pdf_file.write_bytes(make_mock_pdf_bytes(title="Attention Is All You Need", text="Attention Is All You Need. Theoretical foundations and transformer architecture."))

    # Dummy PDF for STANDPDF
    stand_folder = storage_dir / "STANDPDF"
    stand_folder.mkdir(parents=True, exist_ok=True)
    pdf_stand = stand_folder / "manual_guide.pdf"
    pdf_stand.write_bytes(make_mock_pdf_bytes(title="Manual Guide", text="Antigravity Zotero Assistant Standalone Document Guide."))

    return target_dir

def make_mock_pdf_bytes(title: str = "Attention Is All You Need", text: str = "Attention Is All You Need. Theoretical foundations and transformer architecture.") -> bytes:
    """
    Generates a minimal valid, compliant PDF 1.4 binary with extractable text
    and > 1000 bytes size for offline testing without heavy dependencies.
    """
    repeated_text = (text + " ") * 10
    stream_content = f"BT\n/F1 12 Tf\n72 712 Td\n({repeated_text}) Tj\nET\n".encode("latin1")
    stream_len = len(stream_content)

    header = b"%PDF-1.4\n"
    o1 = b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
    o2 = b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
    o3 = b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n"
    o4 = b"4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
    o5 = f"5 0 obj\n<< /Length {stream_len} >>\nstream\n".encode("latin1") + stream_content + b"endstream\nendobj\n"

    pos1 = len(header)
    pos2 = pos1 + len(o1)
    pos3 = pos2 + len(o2)
    pos4 = pos3 + len(o3)
    pos5 = pos4 + len(o4)
    xref_pos = pos5 + len(o5)

    xref = (
        f"xref\n"
        f"0 6\n"
        f"0000000000 65535 f \n"
        f"{pos1:010d} 00000 n \n"
        f"{pos2:010d} 00000 n \n"
        f"{pos3:010d} 00000 n \n"
        f"{pos4:010d} 00000 n \n"
        f"{pos5:010d} 00000 n \n"
        f"trailer\n"
        f"<< /Size 6 /Root 1 0 R >>\n"
        f"startxref\n"
        f"{xref_pos}\n"
        f"%%EOF\n"
    ).encode("latin1")

    return header + o1 + o2 + o3 + o4 + o5 + xref

_MOCK_ENV_DIR: Optional[Path] = None

def ensure_mock_if_needed() -> Optional[Path]:
    """
    Checks if a valid Zotero SQLite database exists in the current environment.
    If not (or if FORCE_MOCK_ZOTERO is set), creates and injects a mock Zotero
    environment into os.environ["ZOTERO_DATA_DIR"] and forces configuration reload.
    Ensures 100% offline test execution without requiring a real Zotero installation.
    """
    global _MOCK_ENV_DIR
    import os
    from src.core.config import get_config
    force = os.environ.get("FORCE_MOCK_ZOTERO", "").lower() in ("1", "true", "yes")
    cfg = get_config()
    if force or not cfg.sqlite_path.exists():
        if _MOCK_ENV_DIR is None or not _MOCK_ENV_DIR.exists():
            td = tempfile.mkdtemp(prefix="mock_zotero_env_")
            _MOCK_ENV_DIR = create_mock_zotero_dir(Path(td))
        os.environ["ZOTERO_DATA_DIR"] = str(_MOCK_ENV_DIR)
        from src.core import config
        config._config_instance = None
        return _MOCK_ENV_DIR
    return None
