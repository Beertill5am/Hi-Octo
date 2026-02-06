import json
import os
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Dict, List, Optional

DB_DIR = os.path.join(os.path.dirname(__file__), "data")
DB_PATH = os.path.join(DB_DIR, "content.db")


def _connect() -> sqlite3.Connection:
    os.makedirs(DB_DIR, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS resources (
                id TEXT PRIMARY KEY,
                filename TEXT NOT NULL,
                original_name TEXT,
                category TEXT NOT NULL,
                source_type TEXT NOT NULL,
                title TEXT,
                author TEXT,
                published_date TEXT,
                source_url TEXT,
                subject TEXT,
                topic TEXT,
                tags TEXT,
                file_path TEXT,
                file_size INTEGER,
                file_hash TEXT,
                chunk_count INTEGER,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT,
                status TEXT DEFAULT 'active'
            );
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS categories (
                name TEXT PRIMARY KEY,
                description TEXT,
                resource_count INTEGER DEFAULT 0,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            );
            """
        )


@dataclass
class ResourceRecord:
    id: str
    filename: str
    original_name: Optional[str]
    category: str
    source_type: str
    title: Optional[str]
    author: Optional[str]
    published_date: Optional[str]
    source_url: Optional[str]
    subject: Optional[str]
    topic: Optional[str]
    tags: List[str]
    file_path: Optional[str]
    file_size: Optional[int]
    file_hash: Optional[str]
    chunk_count: Optional[int]
    created_at: str
    updated_at: Optional[str]
    status: str

    @classmethod
    def from_row(cls, row: sqlite3.Row) -> "ResourceRecord":
        tags = json.loads(row["tags"]) if row["tags"] else []
        return cls(
            id=row["id"],
            filename=row["filename"],
            original_name=row["original_name"],
            category=row["category"],
            source_type=row["source_type"],
            title=row["title"],
            author=row["author"],
            published_date=row["published_date"],
            source_url=row["source_url"],
            subject=row["subject"],
            topic=row["topic"],
            tags=tags,
            file_path=row["file_path"],
            file_size=row["file_size"],
            file_hash=row["file_hash"],
            chunk_count=row["chunk_count"],
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            status=row["status"],
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "filename": self.filename,
            "original_name": self.original_name,
            "category": self.category,
            "source_type": self.source_type,
            "title": self.title,
            "author": self.author,
            "published_date": self.published_date,
            "source_url": self.source_url,
            "subject": self.subject,
            "topic": self.topic,
            "tags": self.tags,
            "file_path": self.file_path,
            "file_size": self.file_size,
            "file_hash": self.file_hash,
            "chunk_count": self.chunk_count,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "status": self.status,
        }


class ResourceRepository:
    def create(self, data: Dict[str, Any]) -> ResourceRecord:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO resources (
                    id, filename, original_name, category, source_type,
                    title, author, published_date, source_url, subject, topic, tags,
                    file_path, file_size, file_hash, chunk_count, updated_at, status
                ) VALUES (
                    :id, :filename, :original_name, :category, :source_type,
                    :title, :author, :published_date, :source_url, :subject, :topic, :tags,
                    :file_path, :file_size, :file_hash, :chunk_count, :updated_at, :status
                );
                """,
                {
                    **data,
                    "tags": json.dumps(data.get("tags") or []),
                    "updated_at": data.get("updated_at") or datetime.now().isoformat(),
                },
            )
            row = conn.execute("SELECT * FROM resources WHERE id = ?", (data["id"],)).fetchone()
        return ResourceRecord.from_row(row)

    def get(self, resource_id: str) -> Optional[ResourceRecord]:
        with _connect() as conn:
            row = conn.execute("SELECT * FROM resources WHERE id = ?", (resource_id,)).fetchone()
        return ResourceRecord.from_row(row) if row else None

    def list(self, category: Optional[str] = None, status: Optional[str] = None) -> List[ResourceRecord]:
        query = "SELECT * FROM resources"
        params: List[Any] = []
        conditions = []
        if category:
            conditions.append("category = ?")
            params.append(category)
        if status:
            conditions.append("status = ?")
            params.append(status)
        if conditions:
            query += " WHERE " + " AND ".join(conditions)
        query += " ORDER BY created_at DESC"
        with _connect() as conn:
            rows = conn.execute(query, params).fetchall()
        return [ResourceRecord.from_row(row) for row in rows]

    def update(self, resource_id: str, fields: Dict[str, Any]) -> Optional[ResourceRecord]:
        if not fields:
            return self.get(resource_id)
        fields = {**fields, "updated_at": datetime.now().isoformat()}
        if "tags" in fields and isinstance(fields["tags"], list):
            fields["tags"] = json.dumps(fields["tags"])
        set_clause = ", ".join([f"{key} = :{key}" for key in fields])
        fields["id"] = resource_id
        with _connect() as conn:
            conn.execute(f"UPDATE resources SET {set_clause} WHERE id = :id", fields)
            row = conn.execute("SELECT * FROM resources WHERE id = ?", (resource_id,)).fetchone()
        return ResourceRecord.from_row(row) if row else None

    def soft_delete(self, resource_id: str) -> Optional[ResourceRecord]:
        return self.update(resource_id, {"status": "deleted"})


class CategoryRepository:
    def ensure(self, name: str, description: Optional[str] = None) -> None:
        with _connect() as conn:
            conn.execute(
                """
                INSERT INTO categories (name, description)
                VALUES (?, ?)
                ON CONFLICT(name) DO UPDATE SET
                    description = COALESCE(excluded.description, categories.description)
                """,
                (name, description),
            )

    def delete(self, name: str) -> None:
        with _connect() as conn:
            conn.execute("DELETE FROM categories WHERE name = ?", (name,))

    def list(self) -> List[Dict[str, Any]]:
        with _connect() as conn:
            rows = conn.execute("SELECT * FROM categories ORDER BY name").fetchall()
        return [dict(row) for row in rows]

    def refresh_counts(self) -> None:
        with _connect() as conn:
            rows = conn.execute(
                "SELECT category, COUNT(*) as count FROM resources WHERE status = 'active' GROUP BY category"
            ).fetchall()
            counts = {row["category"]: row["count"] for row in rows}
            conn.execute("UPDATE categories SET resource_count = 0")
            for category, count in counts.items():
                conn.execute(
                    """
                    UPDATE categories
                    SET resource_count = ?
                    WHERE name = ?
                    """,
                    (count, category),
                )
