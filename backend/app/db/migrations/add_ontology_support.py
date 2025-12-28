"""
Database migration script for KB-scoped ontology support.
"""

from sqlalchemy import text
from app.db.database import engine


def _is_mysql() -> bool:
    return engine.dialect.name.startswith("mysql")


def upgrade():
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("开始数据库迁移：添加本体支持...")

            if _is_mysql():
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS ontology_versions (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        tenant_id INTEGER NOT NULL,
                        knowledge_base_id INTEGER NOT NULL,
                        name VARCHAR(120) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'draft',
                        source VARCHAR(20) NOT NULL DEFAULT 'auto',
                        created_by INTEGER,
                        config JSON,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME,
                        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id),
                        FOREIGN KEY (created_by) REFERENCES users(id)
                    )
                """))

                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS ontology_items (
                        id INTEGER PRIMARY KEY AUTO_INCREMENT,
                        tenant_id INTEGER NOT NULL,
                        knowledge_base_id INTEGER NOT NULL,
                        version_id INTEGER NOT NULL,
                        kind VARCHAR(32) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        description VARCHAR(500),
                        aliases JSON,
                        constraints JSON,
                        confidence FLOAT DEFAULT 0.5,
                        evidence JSON,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        meta JSON,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME,
                        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id),
                        FOREIGN KEY (version_id) REFERENCES ontology_versions(id)
                    )
                """))
            else:
                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS ontology_versions (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id INTEGER NOT NULL,
                        knowledge_base_id INTEGER NOT NULL,
                        name VARCHAR(120) NOT NULL,
                        status VARCHAR(20) NOT NULL DEFAULT 'draft',
                        source VARCHAR(20) NOT NULL DEFAULT 'auto',
                        created_by INTEGER,
                        config TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME,
                        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id),
                        FOREIGN KEY (created_by) REFERENCES users(id)
                    )
                """))

                conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS ontology_items (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        tenant_id INTEGER NOT NULL,
                        knowledge_base_id INTEGER NOT NULL,
                        version_id INTEGER NOT NULL,
                        kind VARCHAR(32) NOT NULL,
                        name VARCHAR(255) NOT NULL,
                        description VARCHAR(500),
                        aliases TEXT,
                        constraints TEXT,
                        confidence FLOAT DEFAULT 0.5,
                        evidence TEXT,
                        status VARCHAR(20) NOT NULL DEFAULT 'pending',
                        meta TEXT,
                        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                        updated_at DATETIME,
                        FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                        FOREIGN KEY (knowledge_base_id) REFERENCES knowledge_bases(id),
                        FOREIGN KEY (version_id) REFERENCES ontology_versions(id)
                    )
                """))

            trans.commit()
            print("数据库迁移成功完成！")
        except Exception as e:
            trans.rollback()
            print(f"迁移失败，已回滚: {e}")
            raise


def downgrade():
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("开始回滚数据库...")
            conn.execute(text("DROP TABLE IF EXISTS ontology_items"))
            conn.execute(text("DROP TABLE IF EXISTS ontology_versions"))
            trans.commit()
            print("数据库回滚成功！")
        except Exception as e:
            trans.rollback()
            print(f"回滚失败: {e}")
            raise


if __name__ == "__main__":
    upgrade()
