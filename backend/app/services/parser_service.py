"""
Parser Service
This service is responsible for parsing text content from various file types.
"""
import fitz  # PyMuPDF
import docx
from io import BytesIO
import logging

logger = logging.getLogger(__name__)

def parse_txt(content: bytes) -> str:
    """Parses text from a .txt file."""
    try:
        return content.decode("utf-8")
    except UnicodeDecodeError:
        logger.warning("Failed to decode TXT file with UTF-8, trying with gbk.")
        try:
            return content.decode("gbk")
        except UnicodeDecodeError:
            logger.error("Failed to decode TXT file with both UTF-8 and gbk.")
            return ""


def parse_pdf(content: bytes) -> str:
    """Parses text from a .pdf file."""
    try:
        doc = fitz.open(stream=content, filetype="pdf")
        text = ""
        for page in doc:
            text += page.get_text()
        return text
    except Exception as e:
        logger.error(f"Error parsing PDF file: {e}", exc_info=True)
        return ""


def parse_docx(content: bytes) -> str:
    """Parses text from a .docx file."""
    try:
        document = docx.Document(BytesIO(content))
        text = "\n".join([para.text for para in document.paragraphs])
        return text
    except Exception as e:
        logger.error(f"Error parsing DOCX file: {e}", exc_info=True)
        return "" 