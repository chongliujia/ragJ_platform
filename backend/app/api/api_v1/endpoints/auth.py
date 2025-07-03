"""
认证相关的API端点
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class AuthRequest(BaseModel):
    username: str
    password: str


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = 3600


@router.post("/login", response_model=AuthResponse)
async def login(request: AuthRequest):
    """
    用户登录（简化版本）
    """
    # 这里是简化版本，实际应该验证用户名密码
    if request.username == "admin" and request.password == "admin":
        return AuthResponse(
            access_token="fake_token_12345",
            expires_in=3600
        )
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")


@router.post("/logout")
async def logout():
    """
    用户登出
    """
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_current_user():
    """
    获取当前用户信息
    """
    return {
        "user_id": "user_123",
        "username": "admin",
        "email": "admin@example.com",
        "role": "admin"
    } 