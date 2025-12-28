#!/bin/sh
set -e

echo "[startup] running ontology migration"
attempt=1
max_attempts=20

while [ $attempt -le $max_attempts ]; do
  if python -m app.db.migrations.add_ontology_support; then
    break
  fi
  echo "[startup] migration failed (attempt $attempt/$max_attempts), retrying..."
  attempt=$((attempt + 1))
  sleep 3
done

if [ $attempt -gt $max_attempts ]; then
  echo "[startup] migration failed after $max_attempts attempts"
  exit 1
fi

echo "[startup] waiting for milvus"
attempt=1
while [ $attempt -le $max_attempts ]; do
  if python - <<'PY'
import os
import socket
host = os.environ.get("MILVUS_HOST", "milvus")
port = int(os.environ.get("MILVUS_PORT", "19530"))
sock = socket.socket()
sock.settimeout(2)
try:
    sock.connect((host, port))
except Exception:
    raise SystemExit(1)
finally:
    sock.close()
PY
  then
    break
  fi
  echo "[startup] milvus not ready (attempt $attempt/$max_attempts), retrying..."
  attempt=$((attempt + 1))
  sleep 3
done

if [ $attempt -gt $max_attempts ]; then
  echo "[startup] milvus not ready after $max_attempts attempts"
  exit 1
fi

exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
