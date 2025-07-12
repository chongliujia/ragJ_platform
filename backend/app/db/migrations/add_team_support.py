"""
Database migration script for adding team management support
"""

from sqlalchemy import text
from app.db.database import engine, SessionLocal
from app.db.models import UserTenant, UserTenantRole, MemberType


def upgrade():
    """升级数据库到支持团队功能"""
    
    with engine.connect() as conn:
        # 开始事务
        trans = conn.begin()
        try:
            print("开始数据库迁移：添加团队管理支持...")
            
            # 步骤1: 为现有tenant表添加团队相关字段（SQLite版本）
            print("步骤1: 扩展tenant表...")
            conn.execute(text("ALTER TABLE tenants ADD COLUMN team_type VARCHAR(20) DEFAULT 'personal'"))
            conn.execute(text("ALTER TABLE tenants ADD COLUMN max_members INTEGER DEFAULT 100"))
            conn.execute(text("ALTER TABLE tenants ADD COLUMN created_by INTEGER"))
            conn.execute(text("ALTER TABLE tenants ADD COLUMN team_avatar TEXT"))
            conn.execute(text("ALTER TABLE tenants ADD COLUMN is_private BOOLEAN DEFAULT 1"))
            
            # 步骤2: 创建user_tenants表（SQLite版本）
            print("步骤2: 创建user_tenants表...")
            conn.execute(text("""
                CREATE TABLE user_tenants (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    user_id INTEGER NOT NULL,
                    tenant_id INTEGER NOT NULL,
                    role VARCHAR(32) DEFAULT 'USER' NOT NULL,
                    member_type VARCHAR(20) DEFAULT 'member' NOT NULL,
                    status VARCHAR(1) DEFAULT '1' NOT NULL,
                    join_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    invited_by INTEGER,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    updated_at DATETIME,
                    
                    FOREIGN KEY (user_id) REFERENCES users(id),
                    FOREIGN KEY (tenant_id) REFERENCES tenants(id),
                    FOREIGN KEY (invited_by) REFERENCES users(id)
                )
            """))
            
            # 步骤3: 创建team_invitations表（SQLite版本）
            print("步骤3: 创建team_invitations表...")
            conn.execute(text("""
                CREATE TABLE team_invitations (
                    id VARCHAR(128) PRIMARY KEY,
                    team_id INTEGER NOT NULL,
                    inviter_id INTEGER NOT NULL,
                    invitee_email VARCHAR(128) NOT NULL,
                    invite_code VARCHAR(128) NOT NULL UNIQUE,
                    target_role VARCHAR(32) DEFAULT 'USER',
                    target_member_type VARCHAR(20) DEFAULT 'member',
                    message TEXT,
                    expire_time DATETIME,
                    used_time DATETIME,
                    used_by INTEGER,
                    status VARCHAR(1) DEFAULT '1',
                    create_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                    update_time DATETIME,
                    create_date VARCHAR(19),
                    update_date VARCHAR(19),
                    
                    FOREIGN KEY (team_id) REFERENCES tenants(id),
                    FOREIGN KEY (inviter_id) REFERENCES users(id),
                    FOREIGN KEY (used_by) REFERENCES users(id)
                )
            """))
            
            # 步骤4: 更新现有数据
            print("步骤4: 迁移现有数据...")
            
            # 将现有租户标记为个人团队，并设置创建人
            result = conn.execute(text("""
                UPDATE tenants 
                SET team_type = 'personal',
                    created_by = (SELECT id FROM users WHERE tenant_id = tenants.id ORDER BY created_at LIMIT 1),
                    is_private = 1
                WHERE team_type IS NULL
            """))
            print(f"更新了 {result.rowcount} 个租户记录")
            
            # 为现有的用户-租户关系创建UserTenant记录
            conn.execute(text("""
                INSERT INTO user_tenants (user_id, tenant_id, role, member_type, status, join_time)
                SELECT 
                    u.id,
                    u.tenant_id,
                    CASE 
                        WHEN u.role = 'super_admin' THEN 'OWNER'
                        WHEN u.role = 'tenant_admin' THEN 'ADMIN'
                        ELSE 'USER'
                    END,
                    CASE 
                        WHEN u.role = 'super_admin' THEN 'owner'
                        WHEN u.role = 'tenant_admin' THEN 'admin'
                        ELSE 'member'
                    END,
                    '1',
                    u.created_at
                FROM users u
                WHERE u.tenant_id IS NOT NULL
            """))
            
            print("数据迁移完成！")
            
            # 提交事务
            trans.commit()
            print("数据库迁移成功完成！")
            
        except Exception as e:
            trans.rollback()
            print(f"迁移失败，已回滚: {e}")
            raise


def downgrade():
    """降级数据库(移除团队功能)"""
    
    with engine.connect() as conn:
        trans = conn.begin()
        try:
            print("开始回滚数据库...")
            
            # 删除外键约束
            conn.execute(text("ALTER TABLE tenants DROP FOREIGN KEY fk_tenant_created_by"))
            
            # 删除新增的表
            conn.execute(text("DROP TABLE IF EXISTS team_invitations"))
            conn.execute(text("DROP TABLE IF EXISTS user_tenants"))
            
            # 移除tenant表的新增字段
            conn.execute(text("ALTER TABLE tenants DROP COLUMN team_type"))
            conn.execute(text("ALTER TABLE tenants DROP COLUMN max_members"))
            conn.execute(text("ALTER TABLE tenants DROP COLUMN created_by"))
            conn.execute(text("ALTER TABLE tenants DROP COLUMN team_avatar"))
            conn.execute(text("ALTER TABLE tenants DROP COLUMN is_private"))
            
            trans.commit()
            print("数据库回滚成功！")
            
        except Exception as e:
            trans.rollback()
            print(f"回滚失败: {e}")
            raise


if __name__ == "__main__":
    # 运行升级
    upgrade()