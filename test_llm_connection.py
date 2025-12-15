#!/usr/bin/env python3
"""
Simple script to test LLM connection without starting the full server
"""

import asyncio
import sys
import os

# Add the backend directory to the Python path
sys.path.append(os.path.join(os.path.dirname(__file__), 'backend'))

from app.services.llm_service import LLMService
from app.core.config import settings


async def test_llm_connection():
    """Test LLM connection independently"""
    
    print("🔧 RAG Platform - LLM Connection Test")
    print("=" * 50)
    
    # Check configuration
    print(f"📋 Configuration:")
    print(f"   DASHSCOPE_API_KEY: {'✅ Set' if settings.DASHSCOPE_API_KEY else '❌ Not set'}")
    print(f"   Chat Model: {settings.QWEN_CHAT_MODEL}")
    print(f"   Embedding Model: {settings.QWEN_EMBEDDING_MODEL}")
    print()
    
    if not settings.DASHSCOPE_API_KEY:
        print("❌ Error: DASHSCOPE_API_KEY is not configured")
        print("💡 Please set DASHSCOPE_API_KEY in your .env file")
        print("   Example: DASHSCOPE_API_KEY=your_api_key_here")
        return False
    
    # Test connection
    print("🔗 Testing LLM connectivity...")
    llm_service = LLMService()
    
    try:
        results = await llm_service.test_all_connections()
        
        print("\n📊 Test Results:")
        print("-" * 30)
        
        for provider, result in results.items():
            if provider == "summary":
                continue
                
            if result.get("success"):
                print(f"✅ {provider.title()}: Connected")
                if "response" in result:
                    print(f"   Response: {result['response'][:100]}...")
                if "usage" in result:
                    usage = result["usage"]
                    print(f"   Usage: {usage}")
            else:
                print(f"❌ {provider.title()}: Failed")
                print(f"   Error: {result.get('error', 'Unknown error')}")
                if "details" in result:
                    print(f"   Details: {result['details'][:200]}...")
        
        # Summary
        summary = results.get("summary", {})
        print(f"\n📈 Summary:")
        print(f"   Total providers: {summary.get('total_providers', 0)}")
        print(f"   Connected: {summary.get('connected_providers', 0)}")
        print(f"   All connected: {'✅ Yes' if summary.get('all_connected') else '❌ No'}")
        
        return summary.get('all_connected', False)
        
    except Exception as e:
        print(f"❌ Test failed with exception: {e}")
        return False


async def test_chat_functionality():
    """Test actual chat functionality"""
    
    print("\n🤖 Testing Chat Functionality")
    print("=" * 50)
    
    llm_service = LLMService()
    test_message = "Hello! Please respond with a brief greeting."
    
    print(f"📝 Test message: {test_message}")
    print("⏳ Sending request...")
    
    try:
        result = await llm_service.chat(
            message=test_message,
            model="qwen-turbo",
            temperature=0.7,
            max_tokens=100
        )
        
        if result.get("success"):
            print("✅ Chat test successful!")
            print(f"🤖 Response: {result.get('message', '')}")
            
            usage = result.get("usage", {})
            if usage:
                print(f"📊 Usage: {usage}")
                
            return True
        else:
            print("❌ Chat test failed!")
            print(f"Error: {result.get('error', 'Unknown error')}")
            return False
            
    except Exception as e:
        print(f"❌ Chat test failed with exception: {e}")
        return False


async def main():
    """Main test function"""
    
    print("🚀 Starting LLM Integration Tests\n")
    
    # Test 1: Connection
    connection_ok = await test_llm_connection()
    
    if not connection_ok:
        print("\n❌ Connection test failed. Skipping chat test.")
        sys.exit(1)
    
    # Test 2: Chat functionality
    chat_ok = await test_chat_functionality()
    
    # Final results
    print("\n" + "=" * 50)
    print("🏁 Final Results:")
    print(f"   Connection Test: {'✅ PASS' if connection_ok else '❌ FAIL'}")
    print(f"   Chat Test: {'✅ PASS' if chat_ok else '❌ FAIL'}")
    
    if connection_ok and chat_ok:
        print("\n🎉 All tests passed! LLM integration is working correctly.")
        print("💡 You can now start the server and use the chat functionality.")
        print("   Server: python backend/app/main.py")
        print("   Provider Test API: POST http://localhost:8000/api/v1/model-config/me/test/<provider>")
    else:
        print("\n❌ Some tests failed. Please check the configuration and try again.")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main()) 
