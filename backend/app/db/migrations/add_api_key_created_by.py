"""
Database migration script for api_keys.created_by
"""

from sqlalchemy import text
from app.db.database import engine


def _column_exists(conn, column_name: str) -> bool:
    dialect = engine.dialect.name
    if dialect == "sqlite":
        rows = conn.execute(text("PRAGMA table_info(api_keys)")).fetchall()
        return any(row[1] == column_name for row in rows)
    if dialect in ("mysql", "mariadb"):
        row = conn.execute(
            text(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_keys' AND COLUMN_NAME = :col"
            ),
            {"col": column_name},
        ).fetchone()
        return row is not None
    return False


def _index_exists(conn, index_name: str) -> bool:
    dialect = engine.dialect.name
    if dialect == "sqlite":
        rows = conn.execute(text("PRAGMA index_list(api_keys)")).fetchall()
        return any(row[1] == index_name for row in rows)
    if dialect in ("mysql", "mariadb"):
        row = conn.execute(
            text(
                "SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'api_keys' AND INDEX_NAME = :idx"
            ),
            {"idx": index_name},
        ).fetchone()
        return row is not None
    return False


def upgrade():
    """Add created_by column and index to api_keys."""
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("Adding api_keys.created_by...")
            if not _column_exists(conn, "created_by"):
                conn.execute(text("ALTER TABLE api_keys ADD COLUMN created_by INTEGER"))
            else:
                print("created_by already exists, skip.")

            if not _index_exists(conn, "idx_api_key_created_by"):
                conn.execute(text("CREATE INDEX idx_api_key_created_by ON api_keys (created_by)"))
            else:
                print("idx_api_key_created_by already exists, skip.")

            trans.commit()
            print("Migration completed.")
        except Exception as e:
            trans.rollback()
            print(f"Migration failed: {e}")
            raise


def downgrade():
    """No-op downgrade for created_by (column removal is destructive)."""
    print("Downgrade skipped: api_keys.created_by not removed.")


if __name__ == "__main__":
    upgrade()
