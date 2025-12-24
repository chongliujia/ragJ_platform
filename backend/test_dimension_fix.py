#!/usr/bin/env python3
"""
Test script to verify dimension mismatch fix
"""
import asyncio
import sys
import os
from pathlib import Path

# This file is a standalone diagnostic script; skip it during pytest collection.
if __name__ != "__main__":  # pragma: no cover
    try:
        import pytest  # type: ignore

        pytest.skip("diagnostic script (not a pytest test)", allow_module_level=True)
    except Exception:
        pass

# Add the backend directory to the Python path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from app.services.milvus_service import milvus_service
from app.services.llm_service import llm_service

async def test_dimension_mismatch():
    """Test the dimension mismatch handling"""
    
    # Test collection name
    test_collection = "test_dimension_mismatch_collection"
    
    print(f"Testing dimension mismatch handling for collection: {test_collection}")
    
    # First, clean up any existing test collection
    if milvus_service.has_collection(test_collection):
        print(f"Dropping existing test collection: {test_collection}")
        milvus_service.drop_collection(test_collection)
    
    # Test 1: Create entities with 1024 dimension vectors (BGE-M3)
    print("\n1. Testing with 1024-dimensional vectors (BGE-M3)...")
    
    # Get embeddings using BGE-M3
    test_texts = ["This is a test document for dimension mismatch testing."]
    
    try:
        embedding_response = await llm_service.get_embeddings(test_texts)
        
        if embedding_response.get("success") and embedding_response.get("embeddings"):
            embeddings = embedding_response["embeddings"]
            vector_dim = len(embeddings[0])
            print(f"Got embeddings with dimension: {vector_dim}")
            
            # Create test entities
            entities = [
                {
                    "text": "Test document 1",
                    "vector": embeddings[0],
                    "tenant_id": 1,
                    "user_id": 1,
                    "document_name": "test_doc_1.txt",
                    "knowledge_base": "test_kb"
                }
            ]
            
            # Test insertion
            print("Inserting entities...")
            result = milvus_service.insert(test_collection, entities)
            print(f"Insert result: {result}")
            
            # Test search
            print("Testing search...")
            search_results = await milvus_service.search(test_collection, embeddings[0], top_k=1)
            print(f"Search results: {len(search_results)} documents found")
            
            # Test collection count
            count = milvus_service.get_collection_count(test_collection)
            print(f"Collection count: {count}")
            
        else:
            print(f"Failed to get embeddings: {embedding_response}")
            
    except Exception as e:
        print(f"Error during test: {e}")
        import traceback
        traceback.print_exc()
    
    # Clean up
    if milvus_service.has_collection(test_collection):
        print(f"\nCleaning up test collection: {test_collection}")
        milvus_service.drop_collection(test_collection)
    
    print("\nTest completed!")

if __name__ == "__main__":
    asyncio.run(test_dimension_mismatch())
