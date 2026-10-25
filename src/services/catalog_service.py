import asyncio
from typing import Any, Optional

from src.core.db import ZoteroDB
from src.domain.models import CollectionNode, LibraryItem
from src.services.validation import validate_8char_key

class CatalogService:
    def __init__(self, db: Optional[ZoteroDB] = None):
        self.db = db or ZoteroDB()

    def get_collections_tree(self) -> list[CollectionNode]:
        raw_nodes = self.db.get_collections_tree()
        def parse_node(d: dict[str, Any]) -> CollectionNode:
            children = [parse_node(c) for c in d.get("children", [])]
            return CollectionNode(
                id=d["id"],
                key=d["key"],
                name=d["name"],
                parent_id=d.get("parent_id"),
                children=children,
            )
        return [parse_node(n) for n in raw_nodes]

    async def get_collections_tree_async(self) -> list[CollectionNode]:
        return await asyncio.to_thread(self.get_collections_tree)

    def get_items(
        self,
        collection_key: Optional[str] = None,
        query: Optional[str] = None,
        tag: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "date_desc",
    ) -> list[LibraryItem]:
        if collection_key and not validate_8char_key(collection_key):
            # Invalid collection key format; return empty to prevent unintended queries
            return []
        raw_items = self.db.get_items(
            collection_key=collection_key,
            query=query,
            tag=tag,
            limit=limit,
            offset=offset,
            order_by=order_by,
        )
        return [LibraryItem(**it) for it in raw_items]

    async def get_items_async(
        self,
        collection_key: Optional[str] = None,
        query: Optional[str] = None,
        tag: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        order_by: str = "date_desc",
    ) -> list[LibraryItem]:
        return await asyncio.to_thread(
            self.get_items,
            collection_key=collection_key,
            query=query,
            tag=tag,
            limit=limit,
            offset=offset,
            order_by=order_by,
        )

    def get_item_by_key(self, item_key: str) -> Optional[LibraryItem]:
        if not validate_8char_key(item_key):
            return None
        raw_item = self.db.get_item_by_key(item_key)
        if not raw_item:
            return None
        return LibraryItem(**raw_item)

    async def get_item_by_key_async(self, item_key: str) -> Optional[LibraryItem]:
        return await asyncio.to_thread(self.get_item_by_key, item_key)
