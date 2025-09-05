"""
工作流持久化数据库迁移脚本
"""

import logging
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import sessionmaker
from app.db.database import Base, get_db
from app.core.config import settings

# 导入工作流模型以注册表
from app.db.models.workflow import (
    WorkflowDefinition,
    WorkflowExecution,
    WorkflowExecutionStep,
    WorkflowTemplate,
    WorkflowSchedule
)

logger = logging.getLogger(__name__)


def create_workflow_tables():
    """创建工作流相关表"""
    try:
        # 创建数据库引擎
        engine = create_engine(settings.DATABASE_URL)
        
        # 检查表是否已存在
        inspector = inspect(engine)
        existing_tables = inspector.get_table_names()
        
        workflow_tables = [
            'workflow_definitions',
            'workflow_executions',
            'workflow_execution_steps',
            'workflow_templates',
            'workflow_schedules'
        ]
        
        # 检查哪些表需要创建
        tables_to_create = [table for table in workflow_tables if table not in existing_tables]
        
        if tables_to_create:
            logger.info(f"Creating workflow tables: {tables_to_create}")
            
            # 只创建工作流相关的表
            workflow_metadata = Base.metadata
            workflow_metadata.create_all(
                bind=engine,
                tables=[
                    WorkflowDefinition.__table__,
                    WorkflowExecution.__table__,
                    WorkflowExecutionStep.__table__,
                    WorkflowTemplate.__table__,
                    WorkflowSchedule.__table__
                ]
            )
            
            logger.info("Workflow tables created successfully")
            return True
        else:
            logger.info("All workflow tables already exist")
            return True
            
    except Exception as e:
        logger.error(f"Failed to create workflow tables: {e}", exc_info=True)
        return False


def migrate_existing_workflows():
    """迁移现有的内存中工作流数据（如果有的话）"""
    try:
        # 这里可以添加迁移现有工作流数据的逻辑
        # 由于当前系统使用内存存储，这个函数主要是为了将来扩展
        logger.info("Workflow data migration completed (no existing data to migrate)")
        return True
        
    except Exception as e:
        logger.error(f"Failed to migrate workflow data: {e}", exc_info=True)
        return False


def add_indexes():
    """添加额外的数据库索引以优化查询性能"""
    try:
        engine = create_engine(settings.DATABASE_URL)
        
        # 这里可以添加特定的索引创建逻辑
        # 例如复合索引等
        with engine.connect() as connection:
            # 示例：为工作流执行记录添加复合索引
            try:
                connection.execute("""
                    CREATE INDEX IF NOT EXISTS idx_workflow_executions_tenant_status 
                    ON workflow_executions (tenant_id, status, created_at DESC);
                """)
                
                connection.execute("""
                    CREATE INDEX IF NOT EXISTS idx_workflow_execution_steps_execution_status 
                    ON workflow_execution_steps (execution_uuid, status);
                """)
                
                connection.execute("""
                    CREATE INDEX IF NOT EXISTS idx_workflow_definitions_tenant_status 
                    ON workflow_definitions (tenant_id, status, updated_at DESC);
                """)
                
                connection.execute("""
                    CREATE INDEX IF NOT EXISTS idx_workflow_templates_category 
                    ON workflow_templates (category, subcategory, is_public, is_active);
                """)
                
                logger.info("Database indexes created successfully")
                
            except Exception as index_error:
                # 如果索引已存在，忽略错误
                logger.warning(f"Some indexes may already exist: {index_error}")
        
        return True
        
    except Exception as e:
        logger.error(f"Failed to create indexes: {e}", exc_info=True)
        return False


def run_migration():
    """运行完整的工作流持久化迁移"""
    logger.info("Starting workflow persistence migration...")
    
    # 步骤1：创建表
    if not create_workflow_tables():
        logger.error("Failed to create workflow tables")
        return False
    
    # 步骤2：迁移数据（如果需要）
    if not migrate_existing_workflows():
        logger.error("Failed to migrate existing workflow data")
        return False
    
    # 步骤3：添加索引
    if not add_indexes():
        logger.error("Failed to create database indexes")
        return False
    
    logger.info("Workflow persistence migration completed successfully")
    return True


if __name__ == "__main__":
    # 设置日志
    logging.basicConfig(level=logging.INFO)
    
    # 运行迁移
    success = run_migration()
    
    if success:
        print("✅ Workflow persistence migration completed successfully")
    else:
        print("❌ Workflow persistence migration failed")
        exit(1)