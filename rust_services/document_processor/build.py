#!/usr/bin/env python3
"""
Build script for the Rust document processor.
Compiles the Rust library and sets up Python bindings.
"""

import os
import sys
import subprocess
import shutil
from pathlib import Path

def run_command(cmd, cwd=None):
    """Run a command and return its output."""
    print(f"Running: {' '.join(cmd)}")
    try:
        result = subprocess.run(
            cmd, 
            cwd=cwd, 
            check=True, 
            capture_output=True, 
            text=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        print(f"Error running command: {e}")
        print(f"Stdout: {e.stdout}")
        print(f"Stderr: {e.stderr}")
        sys.exit(1)

def check_rust_installation():
    """Check if Rust is installed."""
    try:
        output = run_command(["rustc", "--version"])
        print(f"Rust version: {output.strip()}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("Error: Rust is not installed or not in PATH")
        print("Please install Rust from https://rustup.rs/")
        return False

def check_dependencies():
    """Check for required system dependencies."""
    dependencies = {
        "pkg-config": ["pkg-config", "--version"],
        "cmake": ["cmake", "--version"],
    }
    
    missing = []
    for name, cmd in dependencies.items():
        try:
            run_command(cmd)
            print(f"✓ {name} is available")
        except (subprocess.CalledProcessError, FileNotFoundError):
            missing.append(name)
    
    if missing:
        print(f"Missing dependencies: {', '.join(missing)}")
        print("Please install them using your system package manager:")
        print("  Ubuntu/Debian: sudo apt-get install pkg-config cmake")
        print("  macOS: brew install pkg-config cmake")
        print("  Windows: Install via chocolatey or manually")
        return False
    
    return True

def build_rust_library():
    """Build the Rust library."""
    rust_dir = Path(__file__).parent
    
    print("Building Rust library...")
    
    # Build with release optimizations
    run_command(["cargo", "build", "--release"], cwd=rust_dir)
    
    # Find the built library
    target_dir = rust_dir / "target" / "release"
    
    # Different extensions for different platforms
    if sys.platform == "win32":
        lib_name = "document_processor.dll"
    elif sys.platform == "darwin":
        lib_name = "libdocument_processor.dylib"
    else:
        lib_name = "libdocument_processor.so"
    
    lib_path = target_dir / lib_name
    
    if not lib_path.exists():
        print(f"Error: Built library not found at {lib_path}")
        sys.exit(1)
    
    print(f"✓ Built library: {lib_path}")
    return lib_path

def setup_python_bindings(lib_path):
    """Set up Python bindings."""
    backend_dir = Path(__file__).parent.parent.parent / "backend"
    rust_bindings_dir = backend_dir / "rust_bindings"
    
    # Create rust_bindings directory
    rust_bindings_dir.mkdir(exist_ok=True)
    
    # Copy the built library
    if sys.platform == "win32":
        target_name = "document_processor.pyd"
    else:
        target_name = "document_processor.so"
    
    target_path = rust_bindings_dir / target_name
    shutil.copy2(lib_path, target_path)
    
    # Create __init__.py
    init_py = rust_bindings_dir / "__init__.py"
    init_py.write_text('''"""
Rust document processor bindings.
"""

from .document_processor import (
    parse_document,
    get_supported_formats,
    extract_metadata,
    process_batch_documents,
    clean_text,
    chunk_text,
    detect_language,
)

__all__ = [
    "parse_document",
    "get_supported_formats", 
    "extract_metadata",
    "process_batch_documents",
    "clean_text",
    "chunk_text",
    "detect_language",
]
''')
    
    print(f"✓ Python bindings set up in: {rust_bindings_dir}")
    return rust_bindings_dir

def create_python_wrapper():
    """Create a Python wrapper for easier integration."""
    backend_dir = Path(__file__).parent.parent.parent / "backend"
    wrapper_path = backend_dir / "app" / "services" / "rust_document_service.py"
    
    wrapper_content = '''"""
Rust document processor service wrapper.
"""

import logging
from typing import List, Dict, Any, Optional
from pathlib import Path

logger = logging.getLogger(__name__)

try:
    from rust_bindings import (
        parse_document,
        get_supported_formats,
        extract_metadata,
        process_batch_documents,
        clean_text,
        chunk_text,
        detect_language,
    )
    RUST_AVAILABLE = True
except ImportError as e:
    logger.warning(f"Rust bindings not available: {e}")
    RUST_AVAILABLE = False

class RustDocumentProcessor:
    """High-level wrapper for Rust document processing."""
    
    def __init__(self):
        if not RUST_AVAILABLE:
            raise RuntimeError("Rust document processor not available")
    
    def parse_file(self, file_path: str, options: Optional[Dict[str, Any]] = None) -> str:
        """Parse a document file."""
        with open(file_path, 'rb') as f:
            content = f.read()
        
        filename = Path(file_path).name
        return parse_document(content, filename, options)
    
    def parse_content(self, content: bytes, filename: str, options: Optional[Dict[str, Any]] = None) -> str:
        """Parse document content."""
        return parse_document(content, filename, options)
    
    def get_metadata(self, file_path: str) -> Dict[str, str]:
        """Extract metadata from a document."""
        with open(file_path, 'rb') as f:
            content = f.read()
        
        filename = Path(file_path).name
        return extract_metadata(content, filename)
    
    def process_batch(self, files: List[str], options: Optional[Dict[str, Any]] = None) -> List[str]:
        """Process multiple files in batch."""
        documents = []
        for file_path in files:
            with open(file_path, 'rb') as f:
                content = f.read()
            filename = Path(file_path).name
            documents.append((content, filename))
        
        return process_batch_documents(documents, options)
    
    def clean_and_chunk_text(
        self, 
        text: str, 
        chunk_size: int = 1000, 
        overlap: int = 100,
        clean_options: Optional[Dict[str, Any]] = None,
        chunk_options: Optional[Dict[str, Any]] = None
    ) -> List[str]:
        """Clean text and split into chunks."""
        cleaned = clean_text(text, clean_options)
        return chunk_text(cleaned, chunk_size, overlap, chunk_options)
    
    def detect_text_language(self, text: str) -> str:
        """Detect the language of text."""
        return detect_language(text)
    
    @property
    def supported_formats(self) -> List[str]:
        """Get list of supported file formats."""
        return get_supported_formats()

# Global instance
rust_processor = RustDocumentProcessor() if RUST_AVAILABLE else None
'''
    
    wrapper_path.write_text(wrapper_content)
    print(f"✓ Python wrapper created: {wrapper_path}")

def run_tests():
    """Run tests to verify the build."""
    rust_dir = Path(__file__).parent
    
    print("Running Rust tests...")
    run_command(["cargo", "test", "--release"], cwd=rust_dir)
    
    print("✓ All tests passed")

def main():
    """Main build process."""
    print("=== Building Rust Document Processor ===")
    
    # Check prerequisites
    if not check_rust_installation():
        sys.exit(1)
    
    if not check_dependencies():
        sys.exit(1)
    
    # Build the library
    lib_path = build_rust_library()
    
    # Set up Python integration
    setup_python_bindings(lib_path)
    create_python_wrapper()
    
    # Run tests
    run_tests()
    
    print("\\n=== Build Complete ===")
    print("The Rust document processor has been built and integrated successfully!")
    print("\\nNext steps:")
    print("1. Test the integration with: python -c 'from rust_bindings import get_supported_formats; print(get_supported_formats())'")
    print("2. Update your Python services to use the RustDocumentProcessor")
    print("3. Run performance benchmarks to verify improvements")

if __name__ == "__main__":
    main()
'''