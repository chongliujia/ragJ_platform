"""
工作流数据模型
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Boolean,
    DateTime,
    Text,
    ForeignKey,
    JSON,
    Float,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
import enum

from app.db.database import Base


class WorkflowStatus(enum.Enum):
    """工作流状态"""
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


class ExecutionStatus(enum.Enum):
    """执行状态"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    PAUSED = "paused"


class WorkflowDefinition(Base):
    """工作流定义模型"""
    
    __tablename__ = "workflow_definitions"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 基本信息
    workflow_id = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text)
    version = Column(String(50), default="1.0.0")
    
    # 租户和所有者
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 状态
    status = Column(String(20), default=WorkflowStatus.DRAFT.value, nullable=False)
    is_public = Column(Boolean, default=False)
    
    # 工作流定义
    nodes = Column(JSON, nullable=False)  # 节点列表
    edges = Column(JSON, nullable=False)  # 边列表
    global_config = Column(JSON, default={})  # 全局配置
    # 注意：SQLAlchemy Declarative API 中 "metadata" 是保留名。
    # 使用属性名 workflow_metadata，数据库列名仍为 "metadata" 以保持兼容。
    workflow_metadata = Column("metadata", JSON, default={})  # 元数据
    
    # 统计信息
    execution_count = Column(Integer, default=0)
    success_count = Column(Integer, default=0)
    failure_count = Column(Integer, default=0)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    last_executed_at = Column(DateTime(timezone=True))
    
    # 关联关系
    owner = relationship("User")
    tenant = relationship("Tenant")
    executions = relationship("WorkflowExecution", back_populates="workflow", cascade="all, delete-orphan")


class WorkflowExecution(Base):
    """工作流执行记录模型"""
    
    __tablename__ = "workflow_executions"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 执行信息
    execution_id = Column(String(255), unique=True, nullable=False, index=True)
    workflow_id = Column(Integer, ForeignKey("workflow_definitions.id"), nullable=False)
    workflow_definition_id = Column(String(255), nullable=False)  # 冗余字段便于查询
    
    # 租户和执行者
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    executed_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 执行状态
    status = Column(String(20), default=ExecutionStatus.PENDING.value, nullable=False)
    error_message = Column(Text)
    
    # 执行数据
    input_data = Column(JSON, default={})
    output_data = Column(JSON, default={})
    global_context = Column(JSON, default={})
    
    # 执行配置
    config = Column(JSON, default={})
    debug = Column(Boolean, default=False)
    enable_parallel = Column(Boolean, default=True)
    
    # 执行指标
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    duration = Column(Float)  # 秒
    total_steps = Column(Integer, default=0)
    completed_steps = Column(Integer, default=0)
    failed_steps = Column(Integer, default=0)
    
    # 性能指标
    cpu_usage = Column(Float)
    memory_usage = Column(Float)
    metrics = Column(JSON, default={})
    
    # 检查点数据
    checkpoints = Column(JSON, default=[])
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # 关联关系
    workflow = relationship("WorkflowDefinition", back_populates="executions")
    executor = relationship("User")
    tenant = relationship("Tenant")
    steps = relationship("WorkflowExecutionStep", back_populates="execution", cascade="all, delete-orphan")


class WorkflowExecutionStep(Base):
    """工作流执行步骤模型"""
    
    __tablename__ = "workflow_execution_steps"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 步骤信息
    step_id = Column(String(255), nullable=False)
    execution_id = Column(Integer, ForeignKey("workflow_executions.id"), nullable=False)
    execution_uuid = Column(String(255), nullable=False, index=True)  # 冗余字段便于查询
    
    # 节点信息
    node_id = Column(String(255), nullable=False)
    node_name = Column(String(255), nullable=False)
    node_type = Column(String(100), nullable=False)
    
    # 执行状态
    status = Column(String(20), default=ExecutionStatus.PENDING.value, nullable=False)
    error_message = Column(Text)
    retry_count = Column(Integer, default=0)
    
    # 执行数据
    input_data = Column(JSON, default={})
    output_data = Column(JSON, default={})
    
    # 执行时间
    start_time = Column(DateTime(timezone=True))
    end_time = Column(DateTime(timezone=True))
    duration = Column(Float)  # 秒
    
    # 性能指标
    memory_usage = Column(Float)
    cpu_usage = Column(Float)
    step_metrics = Column(JSON, default={})
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # 关联关系
    execution = relationship("WorkflowExecution", back_populates="steps")


class WorkflowTemplate(Base):
    """工作流模板模型"""
    
    __tablename__ = "workflow_templates"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 基本信息
    template_id = Column(String(255), unique=True, nullable=False, index=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    
    # 分类信息
    category = Column(String(100), nullable=False)
    subcategory = Column(String(100))
    tags = Column(JSON, default=[])
    
    # 模板属性
    difficulty = Column(String(50), default="intermediate")
    estimated_time = Column(String(100))
    use_cases = Column(JSON, default=[])
    requirements = Column(JSON, default=[])
    
    # 租户和作者
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 状态
    is_public = Column(Boolean, default=True)
    is_featured = Column(Boolean, default=False)
    is_premium = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    
    # 模板定义
    nodes = Column(JSON, nullable=False)
    edges = Column(JSON, nullable=False)
    global_config = Column(JSON, default={})
    
    # 示例数据
    example_inputs = Column(JSON, default={})
    example_outputs = Column(JSON, default={})
    
    # 统计信息
    downloads = Column(Integer, default=0)
    rating = Column(Float, default=0.0)
    rating_count = Column(Integer, default=0)
    usage_count = Column(Integer, default=0)
    
    # 版本信息
    version = Column(String(50), default="1.0.0")
    changelog = Column(Text)
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # 关联关系
    author = relationship("User")
    tenant = relationship("Tenant")


class WorkflowSchedule(Base):
    """工作流调度模型"""
    
    __tablename__ = "workflow_schedules"
    
    id = Column(Integer, primary_key=True, index=True)
    
    # 调度信息
    schedule_id = Column(String(255), unique=True, nullable=False, index=True)
    workflow_id = Column(Integer, ForeignKey("workflow_definitions.id"), nullable=False)
    workflow_definition_id = Column(String(255), nullable=False)
    
    # 租户和创建者
    tenant_id = Column(Integer, ForeignKey("tenants.id"), nullable=False)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    
    # 调度配置
    name = Column(String(255), nullable=False)
    description = Column(Text)
    cron_expression = Column(String(255), nullable=False)
    timezone = Column(String(50), default="UTC")
    
    # 状态
    is_active = Column(Boolean, default=True)
    
    # 执行配置
    input_data = Column(JSON, default={})
    config = Column(JSON, default={})
    
    # 统计信息
    total_runs = Column(Integer, default=0)
    success_runs = Column(Integer, default=0)
    failed_runs = Column(Integer, default=0)
    
    # 时间信息
    next_run_time = Column(DateTime(timezone=True))
    last_run_time = Column(DateTime(timezone=True))
    last_run_status = Column(String(20))
    
    # 时间戳
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # 关联关系
    workflow = relationship("WorkflowDefinition")
    creator = relationship("User")
    tenant = relationship("Tenant")
