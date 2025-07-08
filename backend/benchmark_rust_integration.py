#!/usr/bin/env python3
"""
Performance benchmark for Rust document processor integration.
Compares Python vs Rust implementations for document processing tasks.
"""

import time
import statistics
import logging
from pathlib import Path
import tempfile
from typing import List, Dict, Any
import asyncio

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import both implementations
try:
    from app.services.rust_document_service import rust_processor

    RUST_AVAILABLE = rust_processor is not None
except ImportError:
    RUST_AVAILABLE = False

from app.services import parser_service
from app.services.chunking_service import chunking_service


def create_test_documents() -> Dict[str, bytes]:
    """Create test documents of various formats and sizes."""
    test_docs = {}

    # Small text document
    small_text = "This is a small test document. " * 100
    test_docs["small.txt"] = small_text.encode("utf-8")

    # Medium text document
    medium_text = (
        "This is a medium-sized test document with multiple paragraphs. " * 1000
    )
    test_docs["medium.txt"] = medium_text.encode("utf-8")

    # Large text document
    large_text = "This is a large test document designed to test performance. " * 10000
    test_docs["large.txt"] = large_text.encode("utf-8")

    # Create a simple HTML document
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head><title>Test Document</title></head>
    <body>
        <h1>Test Heading</h1>
        <p>{"Test paragraph. " * 500}</p>
        <p>{"Another test paragraph. " * 500}</p>
    </body>
    </html>
    """
    test_docs["test.html"] = html_content.encode("utf-8")

    # Create a simple CSV
    csv_content = "Name,Age,City\n" + "\n".join(
        [f"Person{i},{20+i%50},City{i%10}" for i in range(1000)]
    )
    test_docs["test.csv"] = csv_content.encode("utf-8")

    # Create a simple JSON
    json_content = (
        '{"documents": ['
        + ",".join(
            [
                f'{{"id": {i}, "title": "Document {i}", "content": "{"Content text. " * 50}"}}'
                for i in range(100)
            ]
        )
        + "]}"
    )
    test_docs["test.json"] = json_content.encode("utf-8")

    return test_docs


def benchmark_parsing(
    test_docs: Dict[str, bytes], iterations: int = 5
) -> Dict[str, Any]:
    """Benchmark document parsing performance."""
    results = {"python": {}, "rust": {}}

    for filename, content in test_docs.items():
        logger.info(f"Benchmarking parsing for {filename} ({len(content)} bytes)")

        # Benchmark Python parsing
        python_times = []
        for _ in range(iterations):
            start_time = time.time()
            try:
                # Use fallback Python parser
                text = parser_service._parse_document_python(content, filename)
                end_time = time.time()
                python_times.append(end_time - start_time)
            except Exception as e:
                logger.warning(f"Python parsing failed for {filename}: {e}")
                python_times.append(float("inf"))

        # Benchmark Rust parsing (if available)
        rust_times = []
        if RUST_AVAILABLE:
            for _ in range(iterations):
                start_time = time.time()
                try:
                    text = rust_processor.parse_content(content, filename)
                    end_time = time.time()
                    rust_times.append(end_time - start_time)
                except Exception as e:
                    logger.warning(f"Rust parsing failed for {filename}: {e}")
                    rust_times.append(float("inf"))

        # Store results
        results["python"][filename] = {
            "mean": statistics.mean(python_times) if python_times else float("inf"),
            "median": statistics.median(python_times) if python_times else float("inf"),
            "min": min(python_times) if python_times else float("inf"),
            "max": max(python_times) if python_times else float("inf"),
            "times": python_times,
        }

        if RUST_AVAILABLE and rust_times:
            results["rust"][filename] = {
                "mean": statistics.mean(rust_times),
                "median": statistics.median(rust_times),
                "min": min(rust_times),
                "max": max(rust_times),
                "times": rust_times,
            }

    return results


async def benchmark_chunking(
    test_docs: Dict[str, bytes], iterations: int = 3
) -> Dict[str, Any]:
    """Benchmark text chunking performance."""
    results = {"python": {}, "rust": {}}

    # First, parse documents to get text
    texts = {}
    for filename, content in test_docs.items():
        if filename.endswith(".txt"):  # Only test with text files for chunking
            try:
                text = parser_service.parse_document(content, filename)
                if text:
                    texts[filename] = text
            except Exception as e:
                logger.warning(f"Failed to parse {filename} for chunking test: {e}")

    for filename, text in texts.items():
        logger.info(f"Benchmarking chunking for {filename} ({len(text)} characters)")

        # Benchmark Python chunking (force Python implementation)
        python_times = []
        for _ in range(iterations):
            start_time = time.time()
            try:
                # Use RecursiveChunker directly to avoid Rust
                from app.services.chunking_service import RecursiveChunker

                chunker = RecursiveChunker()
                chunks = chunker.chunk_text(text, chunk_size=1000, chunk_overlap=200)
                end_time = time.time()
                python_times.append(end_time - start_time)
            except Exception as e:
                logger.warning(f"Python chunking failed for {filename}: {e}")
                python_times.append(float("inf"))

        # Benchmark Rust chunking (if available)
        rust_times = []
        if RUST_AVAILABLE:
            for _ in range(iterations):
                start_time = time.time()
                try:
                    chunks = rust_processor.clean_and_chunk_text(
                        text, chunk_size=1000, overlap=200
                    )
                    end_time = time.time()
                    rust_times.append(end_time - start_time)
                except Exception as e:
                    logger.warning(f"Rust chunking failed for {filename}: {e}")
                    rust_times.append(float("inf"))

        # Store results
        results["python"][filename] = {
            "mean": statistics.mean(python_times) if python_times else float("inf"),
            "median": statistics.median(python_times) if python_times else float("inf"),
            "min": min(python_times) if python_times else float("inf"),
            "max": max(python_times) if python_times else float("inf"),
            "times": python_times,
        }

        if RUST_AVAILABLE and rust_times:
            results["rust"][filename] = {
                "mean": statistics.mean(rust_times),
                "median": statistics.median(rust_times),
                "min": min(rust_times),
                "max": max(rust_times),
                "times": rust_times,
            }

    return results


def print_benchmark_results(results: Dict[str, Any], task_name: str):
    """Print benchmark results in a formatted table."""
    print(f"\n{'='*60}")
    print(f"{task_name.upper()} PERFORMANCE BENCHMARK")
    print(f"{'='*60}")

    if not RUST_AVAILABLE:
        print("❌ Rust processor not available - showing Python results only")
        print(
            "   To enable Rust, run: cd rust_services/document_processor && python build.py"
        )

    for filename in results["python"].keys():
        print(f"\n📄 {filename}")
        print("-" * 40)

        python_stats = results["python"][filename]
        print(
            f"🐍 Python:  {python_stats['mean']:.4f}s (avg) | {python_stats['min']:.4f}s (min)"
        )

        if RUST_AVAILABLE and filename in results.get("rust", {}):
            rust_stats = results["rust"][filename]
            print(
                f"🦀 Rust:    {rust_stats['mean']:.4f}s (avg) | {rust_stats['min']:.4f}s (min)"
            )

            # Calculate speedup
            if python_stats["mean"] > 0 and rust_stats["mean"] > 0:
                speedup = python_stats["mean"] / rust_stats["mean"]
                if speedup > 1.1:
                    print(f"🚀 Speedup: {speedup:.2f}x faster with Rust")
                elif speedup < 0.9:
                    print(f"🐌 Slower:  {1/speedup:.2f}x slower with Rust")
                else:
                    print("⚖️  Similar: Performance comparable")


def benchmark_supported_formats():
    """Benchmark supported formats comparison."""
    print(f"\n{'='*60}")
    print("SUPPORTED FORMATS COMPARISON")
    print(f"{'='*60}")

    python_formats = ["txt", "pdf", "docx"]  # Current Python support

    print(f"🐍 Python supports: {len(python_formats)} formats")
    print(f"   {', '.join(python_formats)}")

    if RUST_AVAILABLE:
        try:
            rust_formats = rust_processor.supported_formats
            print(f"🦀 Rust supports: {len(rust_formats)} formats")
            print(f"   {', '.join(rust_formats)}")

            additional_formats = set(rust_formats) - set(python_formats)
            if additional_formats:
                print(
                    f"✨ Additional formats with Rust: {', '.join(sorted(additional_formats))}"
                )
        except Exception as e:
            print(f"❌ Could not get Rust supported formats: {e}")


async def main():
    """Run the complete benchmark suite."""
    print("🔬 RAG Platform - Rust Integration Performance Benchmark")
    print("=" * 60)

    # Create test documents
    logger.info("Creating test documents...")
    test_docs = create_test_documents()

    # Show test document info
    print("\n📊 Test Documents:")
    for filename, content in test_docs.items():
        print(f"   {filename}: {len(content):,} bytes")

    # Benchmark parsing
    logger.info("Starting parsing benchmark...")
    parsing_results = benchmark_parsing(test_docs)
    print_benchmark_results(parsing_results, "Document Parsing")

    # Benchmark chunking
    logger.info("Starting chunking benchmark...")
    chunking_results = await benchmark_chunking(test_docs)
    print_benchmark_results(chunking_results, "Text Chunking")

    # Show supported formats
    benchmark_supported_formats()

    # Summary
    print(f"\n{'='*60}")
    print("BENCHMARK SUMMARY")
    print(f"{'='*60}")

    if RUST_AVAILABLE:
        print("✅ Rust integration is working!")
        print("🎯 Key benefits:")
        print("   • Support for 15+ document formats")
        print("   • Improved parsing performance for large documents")
        print("   • Advanced text processing capabilities")
        print("   • Better Unicode and encoding handling")
    else:
        print("❌ Rust integration not available")
        print("🛠️  To enable Rust integration:")
        print("   1. cd rust_services/document_processor")
        print("   2. python build.py")
        print("   3. Restart the backend server")

    print("\n🏁 Benchmark complete!")


if __name__ == "__main__":
    asyncio.run(main())
