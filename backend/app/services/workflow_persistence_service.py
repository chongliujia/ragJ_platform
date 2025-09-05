"""
工作流持久化服务
替换内存存储，使用数据库持久化工作流数据
"""

import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc, func

from app.db.database import SessionLocal
from app.db.models.workflow import (
    WorkflowDefinition as DBWorkflowDefinition,
    WorkflowExecution as DBWorkflowExecution,
    WorkflowExecutionStep as DBWorkflowExecutionStep,
    WorkflowTemplate as DBWorkflowTemplate,
    WorkflowStatus,
    ExecutionStatus
)
from app.schemas.workflow import (
    WorkflowDefinition,
    WorkflowExecutionContext,
    ExecutionStep,
    WorkflowTemplate
)

logger = logging.getLogger(__name__)


class WorkflowPersistenceService:
    """工作流持久化服务"""
    
    def __init__(self):
        self._db = SessionLocal
    
    def _get_db(self) -> Session:
        """获取数据库会话"""
        return self._db()
    
    # 工作流定义相关方法
    
    def save_workflow_definition(
        self, 
        workflow: WorkflowDefinition, 
        tenant_id: int, 
        owner_id: int
    ) -> str:
        """保存工作流定义"""
        db = self._get_db()
        try:
            db_workflow = DBWorkflowDefinition(
                workflow_id=workflow.id,
                name=workflow.name,
                description=workflow.description,
                version=workflow.version,
                tenant_id=tenant_id,
                owner_id=owner_id,
                status=WorkflowStatus.ACTIVE.value,
                nodes=[node.dict() for node in workflow.nodes],
                edges=[edge.dict() for edge in workflow.edges],
                global_config=workflow.global_config,
                workflow_metadata=workflow.metadata
            )
            
            db.add(db_workflow)
            db.commit()
            db.refresh(db_workflow)
            
            logger.info(f"Saved workflow definition: {workflow.id}")
            return workflow.id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to save workflow definition: {e}", exc_info=True)
            raise
        finally:
            db.close()
    
    def get_workflow_definition(self, workflow_id: str, tenant_id: int) -> Optional[WorkflowDefinition]:
        """获取工作流定义"""
        db = self._get_db()
        try:
            db_workflow = db.query(DBWorkflowDefinition).filter(
                DBWorkflowDefinition.workflow_id == workflow_id,
                DBWorkflowDefinition.tenant_id == tenant_id
            ).first()
            
            if not db_workflow:
                return None
            
            # 转换为Pydantic模型
            from app.schemas.workflow import WorkflowNode, WorkflowEdge
            
            nodes = [WorkflowNode(**node_data) for node_data in db_workflow.nodes]
            edges = [WorkflowEdge(**edge_data) for edge_data in db_workflow.edges]
            
            return WorkflowDefinition(
                id=db_workflow.workflow_id,
                name=db_workflow.name,
                description=db_workflow.description,
                version=db_workflow.version,
                nodes=nodes,
                edges=edges,
                global_config=db_workflow.global_config,
                metadata=db_workflow.workflow_metadata
            )
            
        except Exception as e:
            logger.error(f"Failed to get workflow definition: {e}", exc_info=True)
            return None
        finally:
            db.close()
    
    def list_workflow_definitions(self, tenant_id: int, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        """列出工作流定义"""
        db = self._get_db()
        try:
            query = db.query(DBWorkflowDefinition).filter(
                DBWorkflowDefinition.tenant_id == tenant_id,
                DBWorkflowDefinition.status != WorkflowStatus.ARCHIVED.value
            ).order_by(desc(DBWorkflowDefinition.updated_at))
            
            workflows = query.offset(offset).limit(limit).all()
            
            result = []
            for workflow in workflows:
                # 获取最近执行记录
                last_execution = db.query(DBWorkflowExecution).filter(
                    DBWorkflowExecution.workflow_id == workflow.id
                ).order_by(desc(DBWorkflowExecution.created_at)).first()
                
                result.append({
                    "id": workflow.workflow_id,
                    "name": workflow.name,
                    "description": workflow.description,
                    "version": workflow.version,
                    "status": workflow.status,
                    "node_count": len(workflow.nodes),
                    "edge_count": len(workflow.edges),
                    "execution_count": workflow.execution_count,
                    "success_count": workflow.success_count,
                    "failure_count": workflow.failure_count,
                    "created_at": workflow.created_at.isoformat() if workflow.created_at else None,
                    "updated_at": workflow.updated_at.isoformat() if workflow.updated_at else None,
                    "last_executed_at": workflow.last_executed_at.isoformat() if workflow.last_executed_at else None,
                    "last_execution": {
                        "id": last_execution.execution_id,
                        "status": last_execution.status,
                        "start_time": last_execution.start_time.isoformat() if last_execution.start_time else None,
                        "end_time": last_execution.end_time.isoformat() if last_execution.end_time else None,
                    } if last_execution else None
                })
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to list workflow definitions: {e}", exc_info=True)
            return []
        finally:
            db.close()
    
    def update_workflow_definition(
        self, 
        workflow_id: str, 
        tenant_id: int, 
        updates: Dict[str, Any]
    ) -> bool:
        """更新工作流定义"""
        db = self._get_db()
        try:
            db_workflow = db.query(DBWorkflowDefinition).filter(
                DBWorkflowDefinition.workflow_id == workflow_id,
                DBWorkflowDefinition.tenant_id == tenant_id
            ).first()
            
            if not db_workflow:
                return False
            
            # 更新字段
            for key, value in updates.items():
                if hasattr(db_workflow, key):
                    setattr(db_workflow, key, value)
            
            db.commit()
            logger.info(f"Updated workflow definition: {workflow_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update workflow definition: {e}", exc_info=True)
            return False
        finally:
            db.close()
    
    def delete_workflow_definition(self, workflow_id: str, tenant_id: int) -> bool:
        """删除工作流定义"""
        db = self._get_db()
        try:
            db_workflow = db.query(DBWorkflowDefinition).filter(
                DBWorkflowDefinition.workflow_id == workflow_id,
                DBWorkflowDefinition.tenant_id == tenant_id
            ).first()
            
            if not db_workflow:
                return False
            
            # 软删除：标记为归档状态
            db_workflow.status = WorkflowStatus.ARCHIVED.value
            db.commit()
            
            logger.info(f"Deleted workflow definition: {workflow_id}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete workflow definition: {e}", exc_info=True)
            return False
        finally:
            db.close()
    
    # 工作流执行相关方法
    
    def save_workflow_execution(
        self, 
        execution_context: WorkflowExecutionContext,
        tenant_id: int,
        executed_by: int
    ) -> str:
        """保存工作流执行记录"""
        db = self._get_db()
        try:
            # 获取工作流定义ID
            workflow_def = db.query(DBWorkflowDefinition).filter(
                DBWorkflowDefinition.workflow_id == execution_context.workflow_id,
                DBWorkflowDefinition.tenant_id == tenant_id
            ).first()
            
            if not workflow_def:
                raise ValueError(f"Workflow definition not found: {execution_context.workflow_id}")
            
            db_execution = DBWorkflowExecution(
                execution_id=execution_context.execution_id,
                workflow_id=workflow_def.id,
                workflow_definition_id=execution_context.workflow_id,
                tenant_id=tenant_id,
                executed_by=executed_by,
                status=execution_context.status,
                input_data=execution_context.input_data,
                output_data=execution_context.output_data,
                global_context=execution_context.global_context,
                start_time=datetime.fromtimestamp(execution_context.start_time) if execution_context.start_time else None,
                end_time=datetime.fromtimestamp(execution_context.end_time) if execution_context.end_time else None,
                duration=(execution_context.end_time - execution_context.start_time) if execution_context.end_time else None,
                total_steps=len(execution_context.steps),
                completed_steps=len([s for s in execution_context.steps if s.status == "completed"]),
                failed_steps=len([s for s in execution_context.steps if s.status == "error"]),
                metrics=execution_context.metrics,
                checkpoints=execution_context.checkpoints,
                error_message=execution_context.error
            )
            
            db.add(db_execution)
            db.flush()  # 获取ID
            
            # 保存执行步骤
            for step in execution_context.steps:
                db_step = DBWorkflowExecutionStep(
                    step_id=step.step_id,
                    execution_id=db_execution.id,
                    execution_uuid=execution_context.execution_id,
                    node_id=step.node_id,
                    node_name=step.node_name,
                    node_type="unknown",  # TODO: 从node配置中获取
                    status=step.status,
                    error_message=step.error,
                    input_data=step.input_data,
                    output_data=step.output_data,
                    start_time=datetime.fromtimestamp(step.start_time) if step.start_time else None,
                    end_time=datetime.fromtimestamp(step.end_time) if step.end_time else None,
                    duration=step.duration,
                    memory_usage=step.memory_usage,
                    step_metrics=step.metrics
                )
                db.add(db_step)
            
            # 更新工作流定义统计
            workflow_def.execution_count = (workflow_def.execution_count or 0) + 1
            if execution_context.status == ExecutionStatus.COMPLETED.value:
                workflow_def.success_count = (workflow_def.success_count or 0) + 1
            elif execution_context.status == ExecutionStatus.FAILED.value:
                workflow_def.failure_count = (workflow_def.failure_count or 0) + 1
            
            workflow_def.last_executed_at = datetime.utcnow()
            
            db.commit()
            
            logger.info(f"Saved workflow execution: {execution_context.execution_id}")
            return execution_context.execution_id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to save workflow execution: {e}", exc_info=True)
            raise
        finally:
            db.close()
    
    def get_workflow_execution(
        self, 
        execution_id: str, 
        tenant_id: int
    ) -> Optional[WorkflowExecutionContext]:
        """获取工作流执行记录"""
        db = self._get_db()
        try:
            db_execution = db.query(DBWorkflowExecution).filter(
                DBWorkflowExecution.execution_id == execution_id,
                DBWorkflowExecution.tenant_id == tenant_id
            ).first()
            
            if not db_execution:
                return None
            
            # 获取执行步骤
            db_steps = db.query(DBWorkflowExecutionStep).filter(
                DBWorkflowExecutionStep.execution_uuid == execution_id
            ).all()
            
            steps = []
            for db_step in db_steps:
                step = ExecutionStep(
                    step_id=db_step.step_id,
                    node_id=db_step.node_id,
                    node_name=db_step.node_name,
                    status=db_step.status,
                    start_time=db_step.start_time.timestamp() if db_step.start_time else None,
                    end_time=db_step.end_time.timestamp() if db_step.end_time else None,
                    duration=db_step.duration,
                    input_data=db_step.input_data,
                    output_data=db_step.output_data,
                    error=db_step.error_message,
                    memory_usage=db_step.memory_usage,
                    metrics=db_step.step_metrics
                )
                steps.append(step)
            
            return WorkflowExecutionContext(
                execution_id=db_execution.execution_id,
                workflow_id=db_execution.workflow_definition_id,
                status=db_execution.status,
                start_time=db_execution.start_time.timestamp() if db_execution.start_time else None,
                end_time=db_execution.end_time.timestamp() if db_execution.end_time else None,
                input_data=db_execution.input_data,
                output_data=db_execution.output_data,
                global_context=db_execution.global_context,
                steps=steps,
                checkpoints=db_execution.checkpoints,
                metrics=db_execution.metrics,
                error=db_execution.error_message
            )
            
        except Exception as e:
            logger.error(f"Failed to get workflow execution: {e}", exc_info=True)
            return None
        finally:
            db.close()
    
    def list_workflow_executions(
        self, 
        workflow_id: str, 
        tenant_id: int, 
        limit: int = 50, 
        offset: int = 0
    ) -> List[Dict[str, Any]]:
        """列出工作流执行记录"""
        db = self._get_db()
        try:
            query = db.query(DBWorkflowExecution).filter(
                DBWorkflowExecution.workflow_definition_id == workflow_id,
                DBWorkflowExecution.tenant_id == tenant_id
            ).order_by(desc(DBWorkflowExecution.created_at))
            
            executions = query.offset(offset).limit(limit).all()
            
            result = []
            for execution in executions:
                result.append({
                    "execution_id": execution.execution_id,
                    "workflow_id": execution.workflow_definition_id,
                    "status": execution.status,
                    "start_time": execution.start_time.isoformat() if execution.start_time else None,
                    "end_time": execution.end_time.isoformat() if execution.end_time else None,
                    "duration": execution.duration,
                    "total_steps": execution.total_steps,
                    "completed_steps": execution.completed_steps,
                    "failed_steps": execution.failed_steps,
                    "error_message": execution.error_message,
                    "created_at": execution.created_at.isoformat() if execution.created_at else None,
                    "metrics": execution.metrics
                })
            
            return result
            
        except Exception as e:
            logger.error(f"Failed to list workflow executions: {e}", exc_info=True)
            return []
        finally:
            db.close()
    
    def get_execution_history_paginated(
        self, 
        tenant_id: int,
        workflow_id: Optional[str] = None,
        status: Optional[str] = None,
        limit: int = 20, 
        offset: int = 0
    ) -> Tuple[List[Dict[str, Any]], int]:
        """获取分页的执行历史记录"""
        db = self._get_db()
        try:
            query = db.query(DBWorkflowExecution).filter(
                DBWorkflowExecution.tenant_id == tenant_id
            )
            
            if workflow_id:
                query = query.filter(DBWorkflowExecution.workflow_definition_id == workflow_id)
            
            if status:
                query = query.filter(DBWorkflowExecution.status == status)
            
            # 获取总数
            total = query.count()
            
            # 获取分页数据
            executions = query.order_by(desc(DBWorkflowExecution.created_at)).offset(offset).limit(limit).all()
            
            result = []
            for execution in executions:
                result.append({
                    "execution_id": execution.execution_id,
                    "workflow_id": execution.workflow_definition_id,
                    "workflow_name": execution.workflow.name if execution.workflow else "Unknown",
                    "status": execution.status,
                    "start_time": execution.start_time.isoformat() if execution.start_time else None,
                    "end_time": execution.end_time.isoformat() if execution.end_time else None,
                    "duration": execution.duration,
                    "total_steps": execution.total_steps,
                    "completed_steps": execution.completed_steps,
                    "failed_steps": execution.failed_steps,
                    "success_rate": (execution.completed_steps / execution.total_steps * 100) if execution.total_steps > 0 else 0,
                    "error_message": execution.error_message,
                    "created_at": execution.created_at.isoformat() if execution.created_at else None,
                    "executed_by": execution.executed_by
                })
            
            return result, total
            
        except Exception as e:
            logger.error(f"Failed to get paginated execution history: {e}", exc_info=True)
            return [], 0
        finally:
            db.close()


# 单例实例
workflow_persistence_service = WorkflowPersistenceService()
