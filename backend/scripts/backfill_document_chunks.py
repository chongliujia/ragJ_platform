#!/usr/bin/env python3
import argparse
import asyncio
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from app.services.backfill_service import run_backfill


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill document_chunks from Milvus for documents missing persisted chunks."
    )
    parser.add_argument("--tenant-id", type=int, default=None)
    parser.add_argument("--kb-name", type=str, default=None)
    parser.add_argument("--document-id", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Delete existing chunks and repopulate.")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing to DB.")
    parser.add_argument(
        "--recompute-kb-totals",
        action="store_true",
        help="Recompute KB total_chunks after backfill.",
    )
    args = parser.parse_args()

    updated = asyncio.run(
        run_backfill(
            tenant_id=args.tenant_id,
            kb_name=args.kb_name,
            document_id=args.document_id,
            force=args.force,
            dry_run=args.dry_run,
            recompute_kb_totals=args.recompute_kb_totals,
        )
    )
    print(f"Backfill done. Updated {updated} documents.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
