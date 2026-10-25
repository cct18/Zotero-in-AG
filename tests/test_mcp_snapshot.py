import os
import sys
import json
import tempfile
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from tests.fixtures.mock_zotero import create_mock_zotero_dir

SNAPSHOT_FILE = Path(__file__).resolve().parent / "snapshots" / "mcp_golden_snapshots.json"

def record_or_verify_snapshots(verify: bool = True):
    with tempfile.TemporaryDirectory() as td:
        mock_dir = create_mock_zotero_dir(Path(td))
        old_data_dir = os.environ.get("ZOTERO_DATA_DIR")
        os.environ["ZOTERO_DATA_DIR"] = str(mock_dir)

        try:
            # Re-import or refresh db/storage config
            from src.mcp_server.server import (
                zotero_get_collections,
                zotero_search,
                zotero_get_item,
                zotero_read_pdf,
                zotero_add_note,
                zotero_add_tags,
            )
            # Rebind db and storage in server to point to mock
            from src.core.db import ZoteroDB
            from src.core.storage import StorageResolver
            import src.mcp_server.server as mcp_mod
            mcp_mod.db = ZoteroDB(db_path=mock_dir / "zotero.sqlite")
            mcp_mod.storage = StorageResolver(storage_dir=mock_dir / "storage")

            outputs = {
                "zotero_get_collections": zotero_get_collections(),
                "zotero_search": zotero_search(query="Attention", limit=2),
                "zotero_get_item": zotero_get_item("ATTNKEY1"),
                "zotero_read_pdf": zotero_read_pdf("ATTNKEY1", start_page=1, end_page=1),
                "zotero_add_note": zotero_add_note("ATTNKEY1", "Test Title", "Test Note"),
                "zotero_add_tags": zotero_add_tags("ATTNKEY1", ["test-tag"]),
            }

            if not SNAPSHOT_FILE.exists() or not verify:
                SNAPSHOT_FILE.parent.mkdir(parents=True, exist_ok=True)
                with open(SNAPSHOT_FILE, "w", encoding="utf-8") as f:
                    json.dump(outputs, f, ensure_ascii=False, indent=2)
                print(f"[Snapshot] Recorded golden master snapshots to {SNAPSHOT_FILE}")
                return outputs

            # Verify mode
            with open(SNAPSHOT_FILE, "r", encoding="utf-8") as f:
                golden = json.load(f)

            diffs = []
            for tool_name, expected_output in golden.items():
                actual_output = outputs.get(tool_name)
                if actual_output != expected_output:
                    diffs.append(f"Mismatch in {tool_name}:\nExpected:\n{expected_output}\nActual:\n{actual_output}\n")

            if diffs:
                raise AssertionError(f"MCP Golden Snapshot Verification Failed:\n" + "\n".join(diffs))

            print("[Snapshot] 100% match with Golden Master snapshots (Diff: 0)!")
            return outputs

        finally:
            if old_data_dir is not None:
                os.environ["ZOTERO_DATA_DIR"] = old_data_dir
            else:
                os.environ.pop("ZOTERO_DATA_DIR", None)

if __name__ == "__main__":
    should_record = "--record" in sys.argv or os.environ.get("RECORD_SNAPSHOT") == "1"
    if should_record:
        print("[Snapshot] Running in RECORD mode (--record). Overwriting golden master...")
        record_or_verify_snapshots(verify=False)
    else:
        print("[Snapshot] Running in VERIFY mode (read-only against golden master)...")
        record_or_verify_snapshots(verify=True)
