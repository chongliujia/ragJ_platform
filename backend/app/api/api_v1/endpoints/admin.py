"""
超级管理员功能API端点
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, Depends, status, Query
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_, func
from pydantic import BaseModel

from app.db.database import get_db
from app.db.models.user import User, UserRole, UserConfig
from app.db.models.tenant import Tenant
from app.db.models.knowledge_base import KnowledgeBase
from app.db.models.document import Document
from app.db.models.permission import Permission, RolePermission
from app.core.dependencies import require_super_admin
from app.services.milvus_service import milvus_service

router = APIRouter()


class TenantStats(BaseModel):
    total_tenants: int
    active_tenants: int
    total_users: int
    total_knowledge_bases: int
    total_documents: int


class TenantResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: str
    is_active: bool
    max_users: int
    max_knowledge_bases: int
    max_documents: int
    storage_quota_mb: int
    current_users: int
    current_knowledge_bases: int
    current_documents: int
    current_storage_mb: int
    created_at: str
    updated_at: str


class TenantCreateRequest(BaseModel):
    name: str
    slug: str
    description: Optional[str] = ""
    is_active: bool = True
    max_users: int = 100
    max_knowledge_bases: int = 50
    storage_quota_mb: int = 10240


class TenantUpdateRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None
    max_users: Optional[int] = None
    max_knowledge_bases: Optional[int] = None
    storage_quota_mb: Optional[int] = None


class UserDetailResponse(BaseModel):
    id: int
    username: str
    email: str
    full_name: str
    role: str
    is_active: bool
    tenant_id: int
    tenant_name: str
    knowledge_bases_count: int
    documents_count: int
    created_at: str
    last_login_at: Optional[str] = None


class KnowledgeBaseDetailResponse(BaseModel):
    id: int
    name: str
    description: str
    owner_id: int
    owner_username: str
    tenant_id: int
    tenant_name: str
    is_active: bool
    is_public: bool
    document_count: int
    total_chunks: int
    total_size_bytes: int
    created_at: str


class DocumentDetailResponse(BaseModel):
    id: int
    filename: str
    file_type: str
    file_size: int
    knowledge_base_id: int
    knowledge_base_name: str
    uploaded_by: int
    uploader_username: str
    tenant_id: int
    tenant_name: str
    status: str
    total_chunks: int
    created_at: str


class PermissionManageRequest(BaseModel):
    role: str
    permission_names: List[str]


@router.get("/stats", response_model=TenantStats)
async def get_system_stats(
    current_user: User = Depends(require_super_admin()), db: Session = Depends(get_db)
):
    """获取系统统计信息"""
    stats = TenantStats(
        total_tenants=db.query(Tenant).count(),
        active_tenants=db.query(Tenant).filter(Tenant.is_active == True).count(),
        total_users=db.query(User).count(),
        total_knowledge_bases=db.query(KnowledgeBase).count(),
        total_documents=db.query(Document).count(),
    )

    return stats


@router.get("/tenants", response_model=List[TenantResponse])
async def list_all_tenants(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """获取所有租户列表"""
    tenants = db.query(Tenant).offset(skip).limit(limit).all()

    result = []
    for tenant in tenants:
        current_users = db.query(User).filter(User.tenant_id == tenant.id).count()
        current_knowledge_bases = (
            db.query(KnowledgeBase).filter(KnowledgeBase.tenant_id == tenant.id).count()
        )
        current_documents = (
            db.query(Document)
            .join(KnowledgeBase)
            .filter(KnowledgeBase.tenant_id == tenant.id)
            .count()
        )

        result.append(
            TenantResponse(
                id=tenant.id,
                name=tenant.name,
                slug=tenant.slug,
                description=tenant.description or "",
                is_active=tenant.is_active,
                max_users=tenant.max_users,
                max_knowledge_bases=tenant.max_knowledge_bases,
                max_documents=tenant.max_documents,
                storage_quota_mb=tenant.storage_quota_mb,
                current_users=current_users,
                current_knowledge_bases=current_knowledge_bases,
                current_documents=current_documents,
                current_storage_mb=0,  # TODO: 实现存储计算
                created_at=tenant.created_at.isoformat() if tenant.created_at else "",
                updated_at=tenant.updated_at.isoformat() if tenant.updated_at else "",
            )
        )

    return result


@router.get("/users", response_model=List[UserDetailResponse])
async def list_all_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    tenant_id: Optional[int] = Query(None),
    role: Optional[str] = Query(None),
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """获取所有用户列表"""
    query = db.query(User).join(Tenant, User.tenant_id == Tenant.id)

    # 搜索过滤
    if search:
        query = query.filter(
            or_(
                User.username.contains(search),
                User.email.contains(search),
                User.full_name.contains(search),
            )
        )

    # 租户过滤
    if tenant_id:
        query = query.filter(User.tenant_id == tenant_id)

    # 角色过滤
    if role:
        query = query.filter(User.role == role)

    users = query.offset(skip).limit(limit).all()

    result = []
    for user in users:
        # 统计用户的知识库和文档数量
        knowledge_bases_count = (
            db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user.id).count()
        )
        documents_count = (
            db.query(Document).filter(Document.uploaded_by == user.id).count()
        )

        result.append(
            UserDetailResponse(
                id=user.id,
                username=user.username,
                email=user.email,
                full_name=user.full_name or "",
                role=user.role,
                is_active=user.is_active,
                tenant_id=user.tenant_id,
                tenant_name=user.tenant.name,
                knowledge_bases_count=knowledge_bases_count,
                documents_count=documents_count,
                created_at=user.created_at.isoformat(),
                last_login_at=(
                    user.last_login_at.isoformat() if user.last_login_at else None
                ),
            )
        )

    return result


@router.get("/knowledge-bases", response_model=List[KnowledgeBaseDetailResponse])
async def list_all_knowledge_bases(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    tenant_id: Optional[int] = Query(None),
    owner_id: Optional[int] = Query(None),
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """获取所有知识库列表"""
    query = (
        db.query(KnowledgeBase)
        .join(User, KnowledgeBase.owner_id == User.id)
        .join(Tenant, KnowledgeBase.tenant_id == Tenant.id)
    )

    # 搜索过滤
    if search:
        query = query.filter(
            or_(
                KnowledgeBase.name.contains(search),
                KnowledgeBase.description.contains(search),
            )
        )

    # 租户过滤
    if tenant_id:
        query = query.filter(KnowledgeBase.tenant_id == tenant_id)

    # 所有者过滤
    if owner_id:
        query = query.filter(KnowledgeBase.owner_id == owner_id)

    knowledge_bases = query.offset(skip).limit(limit).all()

    return [
        KnowledgeBaseDetailResponse(
            id=kb.id,
            name=kb.name,
            description=kb.description or "",
            owner_id=kb.owner_id,
            owner_username=kb.owner.username,
            tenant_id=kb.tenant_id,
            tenant_name=kb.tenant.name,
            is_active=kb.is_active,
            is_public=kb.is_public,
            document_count=kb.document_count,
            total_chunks=kb.total_chunks,
            total_size_bytes=kb.total_size_bytes,
            created_at=kb.created_at.isoformat(),
        )
        for kb in knowledge_bases
    ]


@router.get("/documents", response_model=List[DocumentDetailResponse])
async def list_all_documents(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    search: Optional[str] = Query(None),
    tenant_id: Optional[int] = Query(None),
    knowledge_base_id: Optional[int] = Query(None),
    uploaded_by: Optional[int] = Query(None),
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """获取所有文档列表"""
    query = (
        db.query(Document)
        .join(KnowledgeBase, Document.knowledge_base_id == KnowledgeBase.id)
        .join(User, Document.uploaded_by == User.id)
        .join(Tenant, KnowledgeBase.tenant_id == Tenant.id)
    )

    # 搜索过滤
    if search:
        query = query.filter(
            or_(
                Document.filename.contains(search),
                Document.original_filename.contains(search),
                Document.title.contains(search),
            )
        )

    # 租户过滤
    if tenant_id:
        query = query.filter(KnowledgeBase.tenant_id == tenant_id)

    # 知识库过滤
    if knowledge_base_id:
        query = query.filter(Document.knowledge_base_id == knowledge_base_id)

    # 上传者过滤
    if uploaded_by:
        query = query.filter(Document.uploaded_by == uploaded_by)

    documents = query.offset(skip).limit(limit).all()

    return [
        DocumentDetailResponse(
            id=doc.id,
            filename=doc.filename,
            file_type=doc.file_type,
            file_size=doc.file_size,
            knowledge_base_id=doc.knowledge_base_id,
            knowledge_base_name=doc.knowledge_base.name,
            uploaded_by=doc.uploaded_by,
            uploader_username=doc.uploader.username,
            tenant_id=doc.knowledge_base.tenant_id,
            tenant_name=doc.knowledge_base.tenant.name,
            status=doc.status,
            total_chunks=doc.total_chunks,
            created_at=doc.created_at.isoformat(),
        )
        for doc in documents
    ]


@router.get("/permissions")
async def list_all_permissions(
    current_user: User = Depends(require_super_admin()), db: Session = Depends(get_db)
):
    """获取所有权限列表"""
    permissions = db.query(Permission).filter(Permission.is_active == True).all()

    # 按分类分组
    permissions_by_category = {}
    for permission in permissions:
        if permission.category not in permissions_by_category:
            permissions_by_category[permission.category] = []
        permissions_by_category[permission.category].append(
            {
                "id": permission.id,
                "name": permission.name,
                "display_name": permission.display_name,
                "description": permission.description,
            }
        )

    return {"permissions": permissions_by_category}


@router.get("/roles/{role}/permissions")
async def get_role_permissions(
    role: str,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """获取角色的权限列表"""
    permissions = (
        db.query(Permission)
        .join(RolePermission, Permission.id == RolePermission.permission_id)
        .filter(RolePermission.role == role, Permission.is_active == True)
        .all()
    )

    return {
        "role": role,
        "permissions": [
            {
                "id": p.id,
                "name": p.name,
                "display_name": p.display_name,
                "description": p.description,
                "category": p.category,
            }
            for p in permissions
        ],
    }


@router.post("/roles/{role}/permissions")
async def update_role_permissions(
    role: str,
    request: PermissionManageRequest,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """更新角色权限"""
    # 删除现有权限
    db.query(RolePermission).filter(RolePermission.role == role).delete()

    # 获取权限ID映射
    permissions = (
        db.query(Permission).filter(Permission.name.in_(request.permission_names)).all()
    )
    permission_map = {p.name: p.id for p in permissions}

    # 添加新权限
    for permission_name in request.permission_names:
        if permission_name in permission_map:
            role_permission = RolePermission(
                role=role, permission_id=permission_map[permission_name]
            )
            db.add(role_permission)

    db.commit()

    return {"message": f"Role {role} permissions updated successfully"}


@router.delete("/users/{user_id}")
async def force_delete_user(
    user_id: int,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """强制删除用户（超级管理员专用）"""
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself"
        )

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="User not found"
        )

    # 删除用户相关的所有数据
    # 1. 删除用户配置
    db.query(UserConfig).filter(UserConfig.user_id == user_id).delete()

    # 2. 删除用户拥有的知识库和文档
    # 首先删除知识库中的文档
    user_knowledge_bases = (
        db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user_id).all()
    )
    for kb in user_knowledge_bases:
        db.query(Document).filter(Document.knowledge_base_id == kb.id).delete()

    # 然后删除知识库
    db.query(KnowledgeBase).filter(KnowledgeBase.owner_id == user_id).delete()

    # 3. 删除用户上传的文档（但不属于其知识库的）
    db.query(Document).filter(Document.uploaded_by == user_id).delete()

    # 4. 删除用户
    db.delete(user)
    db.commit()

    return {"message": "User and all associated data deleted successfully"}


@router.delete("/knowledge-bases/{kb_id}")
async def force_delete_knowledge_base(
    kb_id: int,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """强制删除知识库（超级管理员专用）"""
    kb = db.query(KnowledgeBase).filter(KnowledgeBase.id == kb_id).first()
    if not kb:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge base not found"
        )

    # 删除知识库中的所有文档
    db.query(Document).filter(Document.knowledge_base_id == kb_id).delete()

    # 删除知识库
    db.delete(kb)
    db.commit()

    return {"message": "Knowledge base and all documents deleted successfully"}


@router.delete("/documents/{doc_id}")
async def force_delete_document(
    doc_id: int,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """强制删除文档（超级管理员专用）"""
    doc = db.query(Document).filter(Document.id == doc_id).first()
    if not doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Document not found"
        )

    # 删除文档
    db.delete(doc)
    db.commit()

    return {"message": "Document deleted successfully"}


# ==================== 租户管理 ====================


@router.post("/tenants", response_model=TenantResponse)
async def create_tenant(
    tenant_data: TenantCreateRequest,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """创建新租户"""
    # 检查slug是否已存在
    existing_tenant = db.query(Tenant).filter(Tenant.slug == tenant_data.slug).first()
    if existing_tenant:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Tenant slug already exists"
        )

    # 创建租户
    new_tenant = Tenant(
        name=tenant_data.name,
        slug=tenant_data.slug,
        description=tenant_data.description,
        is_active=tenant_data.is_active,
        max_users=tenant_data.max_users,
        max_knowledge_bases=tenant_data.max_knowledge_bases,
        storage_quota_mb=tenant_data.storage_quota_mb,
    )

    db.add(new_tenant)
    db.commit()
    db.refresh(new_tenant)

    return TenantResponse(
        id=new_tenant.id,
        name=new_tenant.name,
        slug=new_tenant.slug,
        description=new_tenant.description or "",
        is_active=new_tenant.is_active,
        max_users=new_tenant.max_users,
        max_knowledge_bases=new_tenant.max_knowledge_bases,
        max_documents=new_tenant.max_documents,
        storage_quota_mb=new_tenant.storage_quota_mb,
        current_users=0,
        current_knowledge_bases=0,
        current_documents=0,
        current_storage_mb=0,
        created_at=new_tenant.created_at.isoformat(),
        updated_at=new_tenant.updated_at.isoformat(),
    )


@router.put("/tenants/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: int,
    tenant_data: TenantUpdateRequest,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """更新租户信息"""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found"
        )

    # 更新字段
    if tenant_data.name is not None:
        tenant.name = tenant_data.name
    if tenant_data.description is not None:
        tenant.description = tenant_data.description
    if tenant_data.is_active is not None:
        tenant.is_active = tenant_data.is_active
    if tenant_data.max_users is not None:
        tenant.max_users = tenant_data.max_users
    if tenant_data.max_knowledge_bases is not None:
        tenant.max_knowledge_bases = tenant_data.max_knowledge_bases
    if tenant_data.storage_quota_mb is not None:
        tenant.storage_quota_mb = tenant_data.storage_quota_mb

    db.commit()
    db.refresh(tenant)

    # 统计当前使用情况
    current_users = db.query(User).filter(User.tenant_id == tenant.id).count()
    current_knowledge_bases = (
        db.query(KnowledgeBase).filter(KnowledgeBase.tenant_id == tenant.id).count()
    )
    current_documents = (
        db.query(Document)
        .join(KnowledgeBase)
        .filter(KnowledgeBase.tenant_id == tenant.id)
        .count()
    )

    return TenantResponse(
        id=tenant.id,
        name=tenant.name,
        slug=tenant.slug,
        description=tenant.description or "",
        is_active=tenant.is_active,
        max_users=tenant.max_users,
        max_knowledge_bases=tenant.max_knowledge_bases,
        max_documents=tenant.max_documents,
        storage_quota_mb=tenant.storage_quota_mb,
        current_users=current_users,
        current_knowledge_bases=current_knowledge_bases,
        current_documents=current_documents,
        current_storage_mb=0,  # TODO: 实现存储计算
        created_at=tenant.created_at.isoformat(),
        updated_at=tenant.updated_at.isoformat(),
    )


@router.delete("/tenants/{tenant_id}")
async def delete_tenant(
    tenant_id: int,
    current_user: User = Depends(require_super_admin()),
    db: Session = Depends(get_db),
):
    """删除租户及其所有相关数据"""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Tenant not found"
        )

    # 检查是否是默认租户
    if tenant.slug == "default":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete default tenant",
        )

    # 删除关联的用户、知识库、文档
    # 注意：这将级联删除所有相关数据

    # 删除租户下的所有文档
    documents = (
        db.query(Document)
        .join(KnowledgeBase)
        .filter(KnowledgeBase.tenant_id == tenant_id)
        .all()
    )
    for doc in documents:
        db.delete(doc)

    # 删除租户下的所有知识库
    knowledge_bases = (
        db.query(KnowledgeBase).filter(KnowledgeBase.tenant_id == tenant_id).all()
    )
    for kb in knowledge_bases:
        db.delete(kb)

    # 删除租户下的所有用户配置
    user_configs = (
        db.query(UserConfig).join(User).filter(User.tenant_id == tenant_id).all()
    )
    for config in user_configs:
        db.delete(config)

    # 删除租户下的所有用户
    users = db.query(User).filter(User.tenant_id == tenant_id).all()
    for user in users:
        db.delete(user)

    # 最后删除租户
    db.delete(tenant)
    db.commit()

    return {
        "message": f"Tenant '{tenant.name}' and all associated data deleted successfully"
    }


@router.get("/tenant-stats", response_model=dict)
async def get_tenant_stats(
    current_user: User = Depends(require_super_admin()), db: Session = Depends(get_db)
):
    """获取租户统计信息"""
    total_tenants = db.query(Tenant).count()
    active_tenants = db.query(Tenant).filter(Tenant.is_active == True).count()
    total_users = db.query(User).count()
    total_storage_mb = 0  # TODO: 实现存储计算

    return {
        "total_tenants": total_tenants,
        "active_tenants": active_tenants,
        "total_users": total_users,
        "total_storage_mb": total_storage_mb,
    }


@router.post("/milvus/recreate-collection/{collection_name}")
async def recreate_milvus_collection(
    collection_name: str,
    new_dimension: int = 1024,
    current_user: User = Depends(require_super_admin()),
):
    """重新创建Milvus集合以适应新的向量维度"""
    try:
        success = milvus_service.recreate_collection_with_new_dimension(
            collection_name, new_dimension
        )
        if success:
            return {
                "message": f"Collection '{collection_name}' recreated successfully with dimension {new_dimension}",
                "collection_name": collection_name,
                "new_dimension": new_dimension,
            }
        else:
            raise HTTPException(
                status_code=500, detail="Failed to recreate collection"
            )
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Error recreating collection: {str(e)}"
        )
