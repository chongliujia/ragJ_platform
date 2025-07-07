import requests
import time
import uuid
import os

# --- Configuration ---
BASE_URL = "http://localhost:8000/api/v1"
KB_NAME = f"test_kb_{uuid.uuid4().hex[:6]}"
TEST_DOCUMENT_CONTENT = "The first mission to the moon was Apollo 11, launched in 1969. Neil Armstrong was the first person to walk on the moon."
TEST_DOCUMENT_FILENAME = "test_moon_mission.txt"
QUESTION = "Who was the first person to walk on the moon?"
EXPECTED_CONTEXT_IN_ANSWER = "Neil Armstrong"


def print_step(message):
    """Prints a formatted step message."""
    print(f"\n{'='*20}\n[STEP] {message}\n{'='*20}")


def print_result(success, message):
    """Prints a formatted result message."""
    status = "✅ SUCCESS" if success else "❌ FAILED"
    print(f"[{status}] {message}")


def cleanup():
    """Deletes the test knowledge base."""
    print_step(f"Cleaning up: Deleting knowledge base '{KB_NAME}'")
    try:
        response = requests.delete(f"{BASE_URL}/knowledge-bases/{KB_NAME}")
        if response.status_code == 204:
            print_result(True, f"Knowledge base '{KB_NAME}' deleted successfully.")
        elif response.status_code == 404:
            print_result(True, f"Knowledge base '{KB_NAME}' did not exist, nothing to clean up.")
        else:
            print_result(False, f"Cleanup failed with status {response.status_code}: {response.text}")
    except requests.RequestException as e:
        print_result(False, f"An error occurred during cleanup: {e}")


def run_test():
    """Runs the end-to-end RAG pipeline test."""
    try:
        # --- Step 1: Create Knowledge Base ---
        print_step(f"Creating knowledge base: '{KB_NAME}'")
        response = requests.post(
            f"{BASE_URL}/knowledge-bases/",
            json={"name": KB_NAME, "description": "E2E test KB"},
            timeout=30
        )
        if response.status_code != 201:
            print_result(False, f"Failed to create knowledge base. Status: {response.status_code}, Body: {response.text}")
            return
        print_result(True, f"Knowledge base '{KB_NAME}' created.")

        # --- Step 2: Upload Document ---
        print_step(f"Uploading document to '{KB_NAME}'")
        with open(TEST_DOCUMENT_FILENAME, "w") as f:
            f.write(TEST_DOCUMENT_CONTENT)
        
        with open(TEST_DOCUMENT_FILENAME, "rb") as f:
            files = {'file': (TEST_DOCUMENT_FILENAME, f, 'text/plain')}
            response = requests.post(
                f"{BASE_URL}/knowledge-bases/{KB_NAME}/documents/",
                files=files,
                timeout=30
            )
        
        os.remove(TEST_DOCUMENT_FILENAME) # Clean up the local test file
        
        if response.status_code != 202:
            print_result(False, f"Failed to upload document. Status: {response.status_code}, Body: {response.text}")
            return
        print_result(True, "Document upload accepted. The backend is now processing it.")

        # --- Step 3: Wait for Processing ---
        wait_time = 15
        print_step(f"Waiting for {wait_time} seconds for the backend to process the document...")
        time.sleep(wait_time)
        print_result(True, "Wait complete.")

        # --- Step 4: Chat with RAG ---
        print_step(f"Asking a question to the RAG chat API: '{QUESTION}'")
        response = requests.post(
            f"{BASE_URL}/chat/",
            json={"message": QUESTION, "knowledge_base_id": KB_NAME},
            timeout=60
        )
        
        if response.status_code != 200:
            print_result(False, f"Chat request failed. Status: {response.status_code}, Body: {response.text}")
            return
        
        chat_response = response.json()
        ai_message = chat_response.get("message", "")
        
        print_result(True, f"Received response from AI: '{ai_message}'")

        # --- Step 5: Validate the Response ---
        print_step("Validating the response...")
        if EXPECTED_CONTEXT_IN_ANSWER.lower() in ai_message.lower():
            print_result(True, f"The response contains the expected information: '{EXPECTED_CONTEXT_IN_ANSWER}'.")
        else:
            print_result(False, f"The response DID NOT contain the expected information: '{EXPECTED_CONTEXT_IN_ANSWER}'.")

    except requests.RequestException as e:
        print_result(False, f"A critical error occurred during the test: {e}")
    finally:
        cleanup()


if __name__ == "__main__":
    run_test() 