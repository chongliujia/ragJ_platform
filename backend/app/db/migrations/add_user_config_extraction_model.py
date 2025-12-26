"""
Database migration script for user_configs.preferred_extraction_model
"""

from sqlalchemy import text
from app.db.database import engine


def _column_exists(conn, column_name: str) -> bool:
    dialect = engine.dialect.name
    if dialect == "sqlite":
        rows = conn.execute(text("PRAGMA table_info(user_configs)")).fetchall()
        return any(row[1] == column_name for row in rows)
    if dialect in ("mysql", "mariadb"):
        row = conn.execute(
            text(
                "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'user_configs' AND COLUMN_NAME = :col"
            ),
            {"col": column_name},
        ).fetchone()
        return row is not None
    return False


def upgrade():
    """Add preferred_extraction_model column and backfill values."""
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("Adding user_configs.preferred_extraction_model...")
            if _column_exists(conn, "preferred_extraction_model"):
                print("preferred_extraction_model already exists, skip.")
                trans.commit()
                return

            column_type = "TEXT" if engine.dialect.name == "sqlite" else "VARCHAR(100)"
            conn.execute(
                text(
                    "ALTER TABLE user_configs "
                    f"ADD COLUMN preferred_extraction_model {column_type} DEFAULT 'deepseek-chat'"
                )
            )
            conn.execute(
                text(
                    "UPDATE user_configs "
                    "SET preferred_extraction_model = COALESCE(preferred_chat_model, 'deepseek-chat')"
                )
            )

            trans.commit()
            print("Migration completed.")
        except Exception as e:
            trans.rollback()
            print(f"Migration failed: {e}")
            raise


def downgrade():
    """No-op downgrade for preferred_extraction_model (column removal is destructive)."""
    print("Downgrade skipped: user_configs.preferred_extraction_model not removed.")


if __name__ == "__main__":
    upgrade()
