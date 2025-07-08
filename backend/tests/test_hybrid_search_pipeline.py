"""
End-to-End test for the full Hybrid Search RAG Pipeline.

This script performs the following actions:
1. Creates a new knowledge base.
2. Uploads a test document to it.
3. Waits for the backend to process and index the document in Milvus and Elasticsearch.
4. Asks a question that should trigger the RAG pipeline with hybrid search.
5. Verifies the response.
6. Cleans up by deleting the knowledge base.
"""

import requests
import time
import os
import uuid

# --- Configuration ---
BASE_URL = "http://localhost:8000/api/v1"
KB_NAME = f"test_kb_{uuid.uuid4().hex[:6]}"
TEST_DOCUMENT_FILENAME = "test_apollo_mission.txt"
TEST_DOCUMENT_CONTENT = """
The Apollo program, also known as Project Apollo, was the third United States human spaceflight program carried out by the National Aeronautics and Space Administration (NASA), which succeeded in preparing and landing the first humans on the Moon from 1968 to 1972. The program was first conceived during Dwight D. Eisenhower's administration as a three-person spacecraft to follow the one-person Project Mercury.

The first crewed flight was Apollo 7 in 1968. The program culminated with the Apollo 11 mission in July 1969, which saw Neil Armstrong and Buzz Aldrin become the first humans to walk on the lunar surface. Another six missions were flown, with the last one being Apollo 17 in 1972.
"""
QUESTION = "Who were the first humans to walk on the Moon?"
EXPECTED_ANSWER_KEYWORDS = ["Neil Armstrong", "Buzz Aldrin"]


# --- Helper Functions ---
def print_step(message):
    """Prints a formatted step message."""
    print(f"\n{'='*20}\n[STEP] {message}\n{'='*20}")


def print_result(success, message):
    """Prints a formatted result message."""
    status = "✅ SUCCESS" if success else "❌ FAILED"
    print(f"[{status}] {message}")


def run_test():
    """Runs the end-to-end RAG pipeline test."""
    try:
        # --- Step 1: Create Knowledge Base ---
        print_step(f"Creating knowledge base: '{KB_NAME}'")
        response = requests.post(
            f"{BASE_URL}/knowledge-bases/",
            json={"name": KB_NAME, "description": "E2E Hybrid Search Test KB"},
            timeout=30,
        )
        if response.status_code != 201:
            print_result(
                False,
                f"Failed to create knowledge base. Status: {response.status_code}, Body: {response.text}",
            )
            return False
        print_result(
            True, f"Knowledge base '{KB_NAME}' created in Milvus and Elasticsearch."
        )

        # --- Step 2: Upload Document ---
        print_step(f"Uploading document '{TEST_DOCUMENT_FILENAME}' to '{KB_NAME}'")

        # Create a dummy file to upload
        with open(TEST_DOCUMENT_FILENAME, "w", encoding="utf-8") as f:
            f.write(TEST_DOCUMENT_CONTENT)

        with open(TEST_DOCUMENT_FILENAME, "rb") as f:
            files = {"file": (TEST_DOCUMENT_FILENAME, f, "text/plain")}
            response = requests.post(
                f"{BASE_URL}/knowledge-bases/{KB_NAME}/documents/",
                files=files,
                timeout=30,
            )

        os.remove(TEST_DOCUMENT_FILENAME)  # Clean up the local test file

        if response.status_code != 202:
            print_result(
                False,
                f"Failed to upload document. Status: {response.status_code}, Body: {response.text}",
            )
            return False
        print_result(
            True, "Document upload accepted. The backend is now processing it."
        )

        # --- Step 3: Wait for Processing ---
        wait_time = 15
        print_step(
            f"Waiting for {wait_time} seconds for the backend to process the document..."
        )
        time.sleep(wait_time)
        print_result(True, "Wait complete.")

        # --- Step 4: Chat with RAG ---
        print_step(f"Asking a question to the RAG chat API: '{QUESTION}'")
        response = requests.post(
            f"{BASE_URL}/chat/",
            json={"message": QUESTION, "knowledge_base_id": KB_NAME},
            timeout=60,
        )

        if response.status_code != 200:
            print_result(
                False,
                f"Chat API call failed. Status: {response.status_code}, Body: {response.text}",
            )
            return False

        response_data = response.json()
        answer = response_data.get("message", "")

        print_result(True, f"Received answer: {answer}")

        # Simple check for correctness
        if all(keyword in answer for keyword in EXPECTED_ANSWER_KEYWORDS):
            print_result(True, "Answer contains the expected keywords.")
            return True
        else:
            print_result(
                False,
                f"Answer does not contain all expected keywords: {EXPECTED_ANSWER_KEYWORDS}",
            )
            return False

    finally:
        # --- Step 5: Clean up ---
        print_step(f"Cleaning up by deleting knowledge base '{KB_NAME}'")
        response = requests.delete(f"{BASE_URL}/knowledge-bases/{KB_NAME}", timeout=30)
        if response.status_code == 204:
            print_result(True, "Cleanup successful.")
        else:
            print_result(
                False,
                f"Cleanup failed. Status: {response.status_code}, Body: {response.text}",
            )


if __name__ == "__main__":
    is_success = run_test()
    if is_success:
        print("\n🎉🎉🎉 End-to-end test passed successfully! 🎉🎉🎉")
    else:
        print("\n😞😞😞 End-to-end test failed. Please check the logs. 😞😞😞")
