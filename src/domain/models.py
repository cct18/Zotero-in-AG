import re
from typing import Optional, Any
from pydantic import BaseModel, ConfigDict, Field, field_validator

class CollectionNode(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: int
    key: str
    name: str
    parent_id: Optional[int] = None
    children: list["CollectionNode"] = Field(default_factory=list)

    def __getitem__(self, item: str) -> Any:
        try:
            return getattr(self, item)
        except AttributeError:
            raise KeyError(item)

    def get(self, item: str, default: Any = None) -> Any:
        return getattr(self, item, default)

class LibraryItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    itemID: int
    itemKey: str
    itemType: str
    title: Optional[str] = "（无标题）"
    date: Optional[str] = None
    publication: Optional[str] = None
    abstractNote: Optional[str] = None
    doi: Optional[str] = None
    pdfAttachmentKey: Optional[str] = None
    pdfPath: Optional[str] = None
    dateAdded: Optional[str] = None
    dateModified: Optional[str] = None
    creators: list[str] = Field(default_factory=list)
    hasPdf: bool = False

    def __getitem__(self, item: str) -> Any:
        try:
            return getattr(self, item)
        except AttributeError:
            raise KeyError(item)

    def get(self, item: str, default: Any = None) -> Any:
        return getattr(self, item, default)

class Annotation(BaseModel):
    id: str
    source: str = "local" # "zotero" | "local"
    annotationType: int = 1 # 1=highlight, 3=underline
    color: str = "#ffd400"
    text: Optional[str] = ""
    comment: Optional[str] = ""
    pageLabel: Optional[str] = None
    position: Optional[dict[str, Any]] = None
    pageIndex: int = 0
    rects: list[dict[str, Any]] = Field(default_factory=list)
    createdAt: Optional[int] = None

class NoteCreateRequest(BaseModel):
    item_key: str
    title: str
    content: str
    tags: Optional[list[str]] = None

    @field_validator("item_key")
    @classmethod
    def validate_key(cls, v: str) -> str:
        if not re.match(r"^[A-Za-z0-9]{8}$", v):
            raise ValueError("item_key must be an 8-character alphanumeric string")
        return v

class TranslateRequest(BaseModel):
    text: str
    engine: Optional[str] = "builtin" # "builtin" | "custom"
    api_base: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    prompt: Optional[str] = None

class TestAiRequest(BaseModel):
    api_base: Optional[str] = None
    api_key: str
    model: Optional[str] = None

class AnnotationCreateRequest(BaseModel):
    id: str
    pageNum: int
    color: str
    mode: str = "highlight"
    text: Optional[str] = None
    rects: list[dict[str, float]]
    createdAt: Optional[int] = None
