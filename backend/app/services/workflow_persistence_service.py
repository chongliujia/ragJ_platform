"""
工作流持久化服务
替换内存存储，使用数据库持久化工作流数据
"""

import logging
from typing import Dict, List, Any, Optional, Tuple
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import desc, func, or_

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
        owner_id: int,
        is_public: bool = False,
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
                is_public=bool(is_public),
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
    
    def list_workflow_definitions(
        self,
        tenant_id: int,
        limit: int = 50,
        offset: int = 0,
        user_id: Optional[int] = None,
        is_admin: bool = False,
        include_public: bool = True,
    ) -> List[Dict[str, Any]]:
        """列出工作流定义"""
        db = self._get_db()
        try:
            query = db.query(DBWorkflowDefinition).filter(DBWorkflowDefinition.tenant_id == tenant_id)
            query = query.filter(DBWorkflowDefinition.status != WorkflowStatus.ARCHIVED.value)

            # 非管理员默认只能看到自己的工作流 +（可选）公开工作流
            if user_id is not None and not is_admin:
                conds = [DBWorkflowDefinition.owner_id == user_id]
                if include_public:
                    conds.append(DBWorkflowDefinition.is_public == True)  # noqa: E712
                query = query.filter(or_(*conds))

            query = query.order_by(desc(DBWorkflowDefinition.updated_at))
            
            workflows = query.offset(offset).limit(limit).all()
            
            result = []
            for workflow in workflows:
                # 获取最近执行记录
                last_execution = db.query(DBWorkflowExecution).filter(
                    DBWorkflowExecution.workflow_id == workflow.id,
                    DBWorkflowExecution.tenant_id == tenant_id,
                ).order_by(desc(DBWorkflowExecution.created_at)).first()
                
                result.append({
                    "id": workflow.workflow_id,
                    "name": workflow.name,
                    "description": workflow.description,
                    "version": workflow.version,
                    "status": workflow.status,
                    "owner_id": workflow.owner_id,
                    "is_public": bool(workflow.is_public),
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
        offset: int = 0,
        executed_by: Optional[int] = None,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """列出工作流执行记录"""
        db = self._get_db()
        try:
            query = db.query(DBWorkflowExecution).filter(
                DBWorkflowExecution.workflow_definition_id == workflow_id,
                DBWorkflowExecution.tenant_id == tenant_id
            ).order_by(desc(DBWorkflowExecution.created_at))

            if executed_by is not None:
                query = query.filter(DBWorkflowExecution.executed_by == executed_by)

            total = query.count()
            
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
                    "metrics": execution.metrics,
                    "executed_by": execution.executed_by,
                })
            
            return result, total
            
        except Exception as e:
            logger.error(f"Failed to list workflow executions: {e}", exc_info=True)
            return [], 0
        finally:
            db.close()
    
    def get_execution_history_paginated(
        self, 
        tenant_id: int,
        workflow_id: Optional[str] = None,
        status: Optional[str] = None,
        executed_by: Optional[int] = None,
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

            if executed_by is not None:
                query = query.filter(DBWorkflowExecution.executed_by == executed_by)
            
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

    # 工作流模板相关方法

    def list_workflow_templates(
        self,
        *,
        tenant_id: int,
        limit: int = 20,
        offset: int = 0,
        category: Optional[str] = None,
        difficulty: Optional[str] = None,
        sort_by: str = "popular",
        query: Optional[str] = None,
        tags: Optional[List[str]] = None,
        author_id: Optional[int] = None,
        visible_to_user_id: Optional[int] = None,
        include_inactive: bool = False,
        include_private: bool = True,
    ) -> Tuple[List[Dict[str, Any]], int]:
        """列出租户内可用模板（支持简单筛选/分页）。

        - tenant_id：租户隔离
        - author_id：仅作者模板（用于“我的模板”）
        - include_private：若为 False，则只返回 is_public=True
        """
        db = self._get_db()
        try:
            q = db.query(DBWorkflowTemplate).filter(DBWorkflowTemplate.tenant_id == tenant_id)
            if not include_inactive:
                q = q.filter(DBWorkflowTemplate.is_active == True)  # noqa: E712

            if not include_private:
                q = q.filter(DBWorkflowTemplate.is_public == True)  # noqa: E712

            # 可见性：非管理员场景下，私有模板仅作者可见；公共模板全员可见
            if visible_to_user_id is not None:
                q = q.filter(or_(DBWorkflowTemplate.is_public == True, DBWorkflowTemplate.author_id == visible_to_user_id))  # noqa: E712

            if author_id is not None:
                q = q.filter(DBWorkflowTemplate.author_id == author_id)

            if category:
                q = q.filter(or_(DBWorkflowTemplate.category == category, DBWorkflowTemplate.subcategory == category))

            if difficulty:
                q = q.filter(DBWorkflowTemplate.difficulty == difficulty)

            if query:
                like = f"%{query.strip()}%"
                q = q.filter(or_(DBWorkflowTemplate.name.like(like), DBWorkflowTemplate.description.like(like)))

            # 排序
            sort_key = (sort_by or "popular").lower()
            if sort_key == "newest":
                q = q.order_by(desc(DBWorkflowTemplate.created_at))
            elif sort_key == "rating":
                q = q.order_by(desc(DBWorkflowTemplate.rating), desc(DBWorkflowTemplate.rating_count))
            elif sort_key == "name":
                q = q.order_by(DBWorkflowTemplate.name.asc())
            else:
                q = q.order_by(desc(DBWorkflowTemplate.downloads))

            total = q.count()
            items = q.offset(offset).limit(limit).all()

            def to_dict(tpl: DBWorkflowTemplate) -> Dict[str, Any]:
                return {
                    "id": tpl.template_id,
                    "name": tpl.name,
                    "description": tpl.description,
                    "category": tpl.category,
                    "subcategory": tpl.subcategory,
                    "tags": tpl.tags or [],
                    "difficulty": tpl.difficulty,
                    "estimated_time": tpl.estimated_time,
                    "use_cases": tpl.use_cases or [],
                    "requirements": tpl.requirements or [],
                    "version": tpl.version,
                    "author_id": tpl.author_id,
                    "tenant_id": tpl.tenant_id,
                    "is_public": bool(tpl.is_public),
                    "is_featured": bool(tpl.is_featured),
                    "is_premium": bool(tpl.is_premium),
                    "downloads": tpl.downloads,
                    "rating": tpl.rating,
                    "rating_count": tpl.rating_count,
                    "usage_count": tpl.usage_count,
                    "node_count": len(tpl.nodes or []),
                    "edge_count": len(tpl.edges or []),
                    "created_at": tpl.created_at.isoformat() if tpl.created_at else None,
                    "updated_at": tpl.updated_at.isoformat() if tpl.updated_at else None,
                }

            result = [to_dict(x) for x in items]

            # tags 过滤（跨数据库 JSON 查询兼容性差，这里先走 Python 过滤）
            if tags:
                wanted = {str(x) for x in tags if x}

                def has_any(t: Dict[str, Any]) -> bool:
                    got = {str(x) for x in (t.get("tags") or [])}
                    return bool(got & wanted)

                result = [t for t in result if has_any(t)]
                total = len(result)

            return result, total
        except Exception as e:
            logger.error(f"Failed to list workflow templates: {e}", exc_info=True)
            return [], 0
        finally:
            db.close()

    def get_workflow_template(
        self,
        *,
        tenant_id: int,
        template_id: str,
    ) -> Optional[Dict[str, Any]]:
        db = self._get_db()
        try:
            tpl = (
                db.query(DBWorkflowTemplate)
                .filter(
                    DBWorkflowTemplate.tenant_id == tenant_id,
                    DBWorkflowTemplate.template_id == template_id,
                )
                .first()
            )
            if not tpl:
                return None
            return {
                "id": tpl.template_id,
                "name": tpl.name,
                "description": tpl.description,
                "category": tpl.category,
                "subcategory": tpl.subcategory,
                "tags": tpl.tags or [],
                "difficulty": tpl.difficulty,
                "estimated_time": tpl.estimated_time,
                "use_cases": tpl.use_cases or [],
                "requirements": tpl.requirements or [],
                "version": tpl.version,
                "author_id": tpl.author_id,
                "tenant_id": tpl.tenant_id,
                "is_public": bool(tpl.is_public),
                "is_featured": bool(tpl.is_featured),
                "is_premium": bool(tpl.is_premium),
                "downloads": tpl.downloads,
                "rating": tpl.rating,
                "rating_count": tpl.rating_count,
                "usage_count": tpl.usage_count,
                "nodes": tpl.nodes or [],
                "edges": tpl.edges or [],
                "global_config": tpl.global_config or {},
                "example_inputs": tpl.example_inputs or {},
                "example_outputs": tpl.example_outputs or {},
                "created_at": tpl.created_at.isoformat() if tpl.created_at else None,
                "updated_at": tpl.updated_at.isoformat() if tpl.updated_at else None,
            }
        except Exception as e:
            logger.error(f"Failed to get workflow template: {e}", exc_info=True)
            return None
        finally:
            db.close()

    def create_workflow_template(
        self,
        *,
        tenant_id: int,
        author_id: int,
        template_id: str,
        name: str,
        description: str,
        category: str,
        subcategory: Optional[str],
        tags: List[str],
        difficulty: str,
        estimated_time: str,
        use_cases: List[str],
        requirements: List[str],
        nodes: List[Dict[str, Any]],
        edges: List[Dict[str, Any]],
        is_public: bool,
        global_config: Optional[Dict[str, Any]] = None,
    ) -> str:
        db = self._get_db()
        try:
            tpl = DBWorkflowTemplate(
                template_id=template_id,
                name=name,
                description=description or "",
                category=category,
                subcategory=subcategory,
                tags=tags or [],
                difficulty=difficulty or "intermediate",
                estimated_time=estimated_time,
                use_cases=use_cases or [],
                requirements=requirements or [],
                tenant_id=tenant_id,
                author_id=author_id,
                is_public=bool(is_public),
                nodes=nodes or [],
                edges=edges or [],
                global_config=global_config or {},
                version="1.0.0",
            )
            db.add(tpl)
            db.commit()
            return template_id
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to create workflow template: {e}", exc_info=True)
            raise
        finally:
            db.close()

    def update_workflow_template(
        self,
        *,
        tenant_id: int,
        template_id: str,
        patch: Dict[str, Any],
    ) -> bool:
        db = self._get_db()
        try:
            tpl = (
                db.query(DBWorkflowTemplate)
                .filter(DBWorkflowTemplate.tenant_id == tenant_id, DBWorkflowTemplate.template_id == template_id)
                .first()
            )
            if not tpl:
                return False

            allowed = {
                "name",
                "description",
                "category",
                "subcategory",
                "tags",
                "difficulty",
                "estimated_time",
                "use_cases",
                "requirements",
                "nodes",
                "edges",
                "global_config",
                "is_public",
                "is_featured",
                "is_premium",
                "is_active",
            }
            for k, v in (patch or {}).items():
                if k in allowed:
                    setattr(tpl, k, v)

            db.commit()
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to update workflow template: {e}", exc_info=True)
            raise
        finally:
            db.close()

    def delete_workflow_template(self, *, tenant_id: int, template_id: str) -> bool:
        db = self._get_db()
        try:
            tpl = (
                db.query(DBWorkflowTemplate)
                .filter(DBWorkflowTemplate.tenant_id == tenant_id, DBWorkflowTemplate.template_id == template_id)
                .first()
            )
            if not tpl:
                return False
            db.delete(tpl)
            db.commit()
            return True
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to delete workflow template: {e}", exc_info=True)
            raise
        finally:
            db.close()

    def bump_template_downloads(self, *, tenant_id: int, template_id: str) -> None:
        db = self._get_db()
        try:
            tpl = (
                db.query(DBWorkflowTemplate)
                .filter(DBWorkflowTemplate.tenant_id == tenant_id, DBWorkflowTemplate.template_id == template_id)
                .first()
            )
            if not tpl:
                return
            tpl.downloads = int(tpl.downloads or 0) + 1
            tpl.usage_count = int(tpl.usage_count or 0) + 1
            db.commit()
        except Exception as e:
            db.rollback()
            logger.error(f"Failed to bump template downloads: {e}", exc_info=True)
        finally:
            db.close()


# 单例实例
workflow_persistence_service = WorkflowPersistenceService()
