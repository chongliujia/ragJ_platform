"""
This module defines the Pydantic schemas for Knowledge Base resources.
"""

from pydantic import BaseModel, Field
from typing import Optional, Literal
from datetime import datetime


# Base schema for a Knowledge Base
class KnowledgeBaseBase(BaseModel):
    """Base model for knowledge base attributes."""

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
        description="The unique name of the knowledge base.",
    )
    description: Optional[str] = Field(
        None, max_length=500, description="A brief description of the knowledge base."
    )


# Schema for creating a new Knowledge Base
class KnowledgeBaseCreate(KnowledgeBaseBase):
    """Schema for creating a knowledge base."""

    pass


# Schema for reading/returning a Knowledge Base from the API
class KnowledgeBase(KnowledgeBaseBase):
    """Schema for representing a knowledge base in API responses."""

    id: str = Field(..., description="The unique identifier of the knowledge base.")
    document_count: int = Field(default=0, description="Number of documents in the knowledge base.")
    total_chunks: int = Field(default=0, description="Total number of chunks across all documents.")
    total_size_bytes: int = Field(default=0, description="Total size in bytes of all documents.")
    created_at: datetime = Field(
        ..., description="When the knowledge base was created."
    )
    status: Literal["active", "processing", "error"] = Field(
        default="active", description="Current status of the knowledge base."
    )

    class Config:
        # This allows the model to be created from arbitrary class instances
        # which is useful when creating it from a database model.
        from_attributes = True


# Schema for the response when a knowledge base is created
class KnowledgeBaseCreateResponse(BaseModel):
    """Response schema after creating a knowledge base."""

    data: KnowledgeBase
    msg: str = "Knowledge base created successfully"
