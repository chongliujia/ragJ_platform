"""
This module defines the Pydantic schemas for Knowledge Base resources.
"""
from pydantic import BaseModel, Field
from typing import Optional

# Base schema for a Knowledge Base
class KnowledgeBaseBase(BaseModel):
    """Base model for knowledge base attributes."""
    name: str = Field(..., min_length=1, max_length=100, 
                    description="The unique name of the knowledge base.")
    description: Optional[str] = Field(None, max_length=500,
                                     description="A brief description of the knowledge base.")

# Schema for creating a new Knowledge Base
class KnowledgeBaseCreate(KnowledgeBaseBase):
    """Schema for creating a knowledge base."""
    pass

# Schema for reading/returning a Knowledge Base from the API
class KnowledgeBase(KnowledgeBaseBase):
    """Schema for representing a knowledge base in API responses."""
    # In the future, we can add more fields that are returned by the API,
    # such as id, creation_date, etc.
    # For now, it's the same as the base.
    
    class Config:
        # This allows the model to be created from arbitrary class instances
        # which is useful when creating it from a database model.
        from_attributes = True

# Schema for the response when a knowledge base is created
class KnowledgeBaseCreateResponse(BaseModel):
    """Response schema after creating a knowledge base."""
    msg: str
    knowledge_base_name: str 