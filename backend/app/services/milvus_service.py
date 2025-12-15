"""
This module provides a service for interacting with the Milvus vector database.
"""

import logging
from pymilvus import (
    utility,
    connections,
    Collection,
    CollectionSchema,
    FieldSchema,
    DataType,
    db,
)
from app.core.config import settings

# Configure logging
logging.basicConfig(level=settings.LOG_LEVEL)
logger = logging.getLogger(__name__)


class MilvusService:
    """
    A singleton service for managing connections and operations with Milvus.
    """

    _instance = None

    def __new__(cls, *args, **kwargs):
        if not cls._instance:
            cls._instance = super(MilvusService, cls).__new__(cls, *args, **kwargs)
        return cls._instance

    def __init__(self):
        if not hasattr(self, "initialized"):
            self.alias = "default"
            self.db_name = settings.MILVUS_DATABASE
            self.tenant_collections = {}  # 缓存租户集合
            try:
                # First, try multi-database workflow (Milvus 2.3+)
                try:
                    logger.info(
                        "Connecting to Milvus default database to ensure target DB exists..."
                    )
                    connections.connect(
                        alias="db_check",
                        host=settings.MILVUS_HOST,
                        port=settings.MILVUS_PORT,
                        user=settings.MILVUS_USER,
                        password=settings.MILVUS_PASSWORD,
                    )

                    existing_databases = db.list_database(using="db_check")
                    if self.db_name not in existing_databases:
                        logger.warning(
                            f"Database '{self.db_name}' not found. Creating it now..."
                        )
                        db.create_database(self.db_name, using="db_check")
                        logger.info(f"Database '{self.db_name}' created successfully.")

                    connections.disconnect("db_check")
                    logger.info("Disconnected from default database.")

                    # Now, connect to the target database
                    logger.info(
                        f"Connecting to Milvus at {settings.MILVUS_HOST}:{settings.MILVUS_PORT}, DB: '{self.db_name}'"
                    )
                    connections.connect(
                        alias=self.alias,
                        host=settings.MILVUS_HOST,
                        port=settings.MILVUS_PORT,
                        user=settings.MILVUS_USER,
                        password=settings.MILVUS_PASSWORD,
                        db_name=self.db_name,
                    )
                    logger.info("Successfully connected to Milvus target database.")
                    self.initialized = True
                except Exception as db_err:
                    # Fallback: Milvus without database feature (e.g., Milvus < 2.3)
                    logger.warning(
                        f"Milvus multi-database ops failed ({db_err}). Trying single-DB connection without db_name..."
                    )
                    connections.connect(
                        alias=self.alias,
                        host=settings.MILVUS_HOST,
                        port=settings.MILVUS_PORT,
                        user=settings.MILVUS_USER,
                        password=settings.MILVUS_PASSWORD,
                    )
                    logger.info("Connected to Milvus without specifying database (single-DB mode).")
                    self.initialized = True
            except Exception as e:
                logger.error(f"Failed to connect to Milvus: {e}", exc_info=True)
                self.initialized = False
                # Do not raise here to allow the app to run without Milvus.
                # All operations will be no-op or return empty results when not initialized.
                # This keeps non-RAG features usable even if vector DB is down.

    def list_collections(self) -> list[str]:
        """
        Lists all collections in the Milvus database.

        Returns:
            A list of collection names.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot list collections.")
            return []
        try:
            return utility.list_collections(using=self.alias)
        except Exception as e:
            logger.error(f"Failed to list Milvus collections: {e}", exc_info=True)
            return []

    def has_collection(self, collection_name: str) -> bool:
        """
        Checks if a collection exists in the Milvus database.

        Args:
            collection_name: The name of the collection to check.

        Returns:
            True if the collection exists, False otherwise.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot check collection.")
            return False
        try:
            return utility.has_collection(collection_name, using=self.alias)
        except Exception as e:
            logger.error(
                f"Failed to check for collection {collection_name}: {e}", exc_info=True
            )
            return False

    def create_collection(
        self, collection_name: str, dim: int = settings.EMBEDDING_DIMENSION
    ):
        """
        Creates a new collection in Milvus with a predefined schema.

        Args:
            collection_name: The name for the new collection.
            dim: The dimension of the vector embeddings.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot create collection.")
            return

        if self.has_collection(collection_name):
            logger.warning(f"Collection '{collection_name}' already exists.")
            return

        try:
            # Define fields for the collection
            # Primary key
            pk_field = FieldSchema(
                name="pk", dtype=DataType.INT64, is_primary=True, auto_id=True
            )
            # Original text chunk
            text_field = FieldSchema(
                name="text", dtype=DataType.VARCHAR, max_length=65535
            )
            # Vector embedding
            vector_field = FieldSchema(
                name="vector", dtype=DataType.FLOAT_VECTOR, dim=dim
            )
            # Tenant ID for multi-tenancy
            tenant_id_field = FieldSchema(
                name="tenant_id", dtype=DataType.INT64
            )
            # User ID
            user_id_field = FieldSchema(
                name="user_id", dtype=DataType.INT64
            )
            # Document name
            document_name_field = FieldSchema(
                name="document_name", dtype=DataType.VARCHAR, max_length=512
            )
            # Knowledge base name
            knowledge_base_field = FieldSchema(
                name="knowledge_base", dtype=DataType.VARCHAR, max_length=256
            )

            schema = CollectionSchema(
                fields=[pk_field, text_field, vector_field, tenant_id_field, user_id_field, document_name_field, knowledge_base_field],
                description=f"{collection_name} collection",
            )

            collection = Collection(
                name=collection_name, schema=schema, using=self.alias
            )
            logger.info(f"Successfully created collection: {collection_name}")

            # Create an index for the vector field
            index_params = {
                "metric_type": "L2",
                "index_type": "IVF_FLAT",
                "params": {"nlist": 1024},
            }
            collection.create_index(field_name="vector", index_params=index_params)
            logger.info(f"Successfully created index for collection: {collection_name}")

        except Exception as e:
            logger.error(
                f"Failed to create collection or index for '{collection_name}': {e}",
                exc_info=True,
            )
            # Optionally re-raise or handle the error
            raise

    def drop_collection(self, collection_name: str):
        """
        Drops a collection from the Milvus database.

        Args:
            collection_name: The name of the collection to drop.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot drop collection.")
            return

        if not self.has_collection(collection_name):
            logger.warning(f"Collection '{collection_name}' does not exist.")
            return

        try:
            utility.drop_collection(collection_name, using=self.alias)
            logger.info(f"Successfully dropped collection: {collection_name}")
        except Exception as e:
            logger.error(
                f"Failed to drop collection '{collection_name}': {e}", exc_info=True
            )
            raise

    def insert(self, collection_name: str, entities: list[dict]) -> list[any]:
        """
        Inserts entities into a collection.

        Args:
            collection_name: The name of the collection.
            entities: A list of dictionaries, where each dictionary represents an entity.
                      Example: [{"text": "some text", "vector": [0.1, ...]}, ...]

        Returns:
            A list of primary key IDs for the inserted entities.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot insert data.")
            return []

        if not self.has_collection(collection_name):
            # Rule: KB collections must be created explicitly via KB create/maintenance APIs.
            logger.error(
                f"Collection '{collection_name}' does not exist. Refusing to auto-create; create the KB first."
            )
            raise RuntimeError(f"Collection '{collection_name}' not found")

        try:
            collection = Collection(name=collection_name, using=self.alias)
            # Prepare columnar data from entities
            texts = [entity.get("text", "") for entity in entities]
            vectors = [entity.get("vector") for entity in entities]
            tenant_ids = [int(entity.get("tenant_id", 0)) for entity in entities]
            user_ids = [int(entity.get("user_id", 0)) for entity in entities]
            document_names = [str(entity.get("document_name", "")) for entity in entities]
            knowledge_bases = [str(entity.get("knowledge_base", "")) for entity in entities]

            # Basic sanity: filter out any rows with missing vector or None
            filtered = []
            for i in range(len(entities)):
                v = vectors[i]
                if v is None or (isinstance(v, list) and len(v) == 0):
                    logger.warning(f"Skip entity at index {i} due to empty vector")
                    continue
                filtered.append(i)

            if len(filtered) != len(entities):
                texts = [texts[i] for i in filtered]
                vectors = [vectors[i] for i in filtered]
                tenant_ids = [tenant_ids[i] for i in filtered]
                user_ids = [user_ids[i] for i in filtered]
                document_names = [document_names[i] for i in filtered]
                knowledge_bases = [knowledge_bases[i] for i in filtered]
                logger.warning(
                    f"Filtered entities with invalid vectors: kept {len(filtered)} of {len(entities)} rows"
                )

            # Ensure equal row counts across columns
            lengths = [
                ("texts", len(texts)),
                ("vectors", len(vectors)),
                ("tenant_ids", len(tenant_ids)),
                ("user_ids", len(user_ids)),
                ("document_names", len(document_names)),
                ("knowledge_bases", len(knowledge_bases)),
            ]
            unique_lengths = {l for _, l in lengths}
            if len(unique_lengths) != 1:
                logger.warning(
                    "Inconsistent column lengths before insert: "
                    + ", ".join(f"{k}={v}" for k, v in lengths)
                )
                min_len = min(unique_lengths) if unique_lengths else 0
                texts = texts[:min_len]
                vectors = vectors[:min_len]
                tenant_ids = tenant_ids[:min_len]
                user_ids = user_ids[:min_len]
                document_names = document_names[:min_len]
                knowledge_bases = knowledge_bases[:min_len]
                logger.warning(f"Trimmed all columns to min length {min_len}")

            if len(texts) == 0:
                logger.warning("No valid rows to insert after filtering; returning empty result")
                return []

            data_to_insert = [
                texts,
                vectors,
                tenant_ids,
                user_ids,
                document_names,
                knowledge_bases,
            ]

            result = collection.insert(data_to_insert)
            collection.flush()  # Ensure data is persisted
            logger.info(
                f"Successfully inserted {len(texts)} entities into '{collection_name}'."
            )
            try:
                pks = list(result.primary_keys)  # normalize to list
            except Exception:
                pks = []
            return [int(pk) for pk in pks]
        except Exception as e:
            # 检查是否是维度不匹配错误
            err = str(e).lower()
            if (
                "dimension mismatch" in err
                or "vector dimension" in err
                or "should divide the dim" in err
                or ("length(" in err and "dim(" in err)
                or "not equal to schema dim" in err
                or ("expected=" in err and "actual=" in err and "invalid parameter" in err)
            ):
                logger.warning(f"Vector dimension mismatch detected: {e}")
                try:
                    # 获取当前向量的实际维度
                    current_vector_dim = len(entities[0]["vector"]) if entities else 1024
                    logger.info(f"Attempting to recreate collection with dimension {current_vector_dim}")
                    
                    # 重新创建集合
                    self.recreate_collection_with_new_dimension(collection_name, current_vector_dim)
                    
                    # 重新尝试插入
                    collection = Collection(name=collection_name, using=self.alias)
                    # 重用与上面相同的过滤与对齐逻辑
                    texts = [entity.get("text", "") for entity in entities]
                    vectors = [entity.get("vector") for entity in entities]
                    tenant_ids = [int(entity.get("tenant_id", 0)) for entity in entities]
                    user_ids = [int(entity.get("user_id", 0)) for entity in entities]
                    document_names = [str(entity.get("document_name", "")) for entity in entities]
                    knowledge_bases = [str(entity.get("knowledge_base", "")) for entity in entities]

                    filtered = []
                    for i in range(len(entities)):
                        v = vectors[i]
                        if v is None or (isinstance(v, list) and len(v) == 0):
                            continue
                        filtered.append(i)
                    if len(filtered) != len(entities):
                        texts = [texts[i] for i in filtered]
                        vectors = [vectors[i] for i in filtered]
                        tenant_ids = [tenant_ids[i] for i in filtered]
                        user_ids = [user_ids[i] for i in filtered]
                        document_names = [document_names[i] for i in filtered]
                        knowledge_bases = [knowledge_bases[i] for i in filtered]

                    lengths = [len(texts), len(vectors), len(tenant_ids), len(user_ids), len(document_names), len(knowledge_bases)]
                    if len(set(lengths)) != 1:
                        min_len = min(lengths)
                        texts = texts[:min_len]
                        vectors = vectors[:min_len]
                        tenant_ids = tenant_ids[:min_len]
                        user_ids = user_ids[:min_len]
                        document_names = document_names[:min_len]
                        knowledge_bases = knowledge_bases[:min_len]

                    data_to_insert = [texts, vectors, tenant_ids, user_ids, document_names, knowledge_bases]
                    
                    result = collection.insert(data_to_insert)
                    collection.flush()
                    logger.info(
                        f"Successfully inserted {len(entities)} entities into recreated collection '{collection_name}'."
                    )
                    try:
                        pks = list(result.primary_keys)
                    except Exception:
                        pks = []
                    return [int(pk) for pk in pks]
                except Exception as recreate_error:
                    logger.error(f"Failed to recreate collection and insert data: {recreate_error}")
                    raise recreate_error
            else:
                logger.error(
                    f"Failed to insert data into '{collection_name}': {e}", exc_info=True
                )
                raise

    def delete_vectors(self, collection_name: str, ids: list[int]) -> int:
        """
        Delete vectors by primary key IDs from a collection.

        Args:
            collection_name: Target collection name
            ids: List of primary key IDs to delete

        Returns:
            Number of deleted entities (best-effort based on Milvus response)
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot delete vectors.")
            return 0

        if not ids:
            return 0

        if not self.has_collection(collection_name):
            logger.warning(
                f"Collection '{collection_name}' does not exist. Skip deleting vectors."
            )
            return 0

        try:
            collection = Collection(name=collection_name, using=self.alias)
            expr_ids = ",".join(str(i) for i in ids)
            expr = f"pk in [{expr_ids}]"
            res = collection.delete(expr)
            collection.flush()
            # Milvus doesn't return exact count reliably; try to infer
            deleted = getattr(res, "delete_count", None)
            if deleted is None:
                deleted = len(ids)
            logger.info(
                f"Deleted ~{deleted} vectors from '{collection_name}' with expr: {expr}"
            )
            return int(deleted)
        except Exception as e:
            logger.error(
                f"Failed to delete vectors from '{collection_name}': {e}", exc_info=True
            )
            return 0

    def delete_by_filters(self, collection_name: str, term_filters: dict) -> int:
        """
        Delete vectors by matching field filters (e.g., document_name, tenant_id, knowledge_base).

        Args:
            collection_name: Target collection name
            term_filters: Field -> value exact matches

        Returns:
            Approximate number of deleted entities
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot delete by filters.")
            return 0

        if not self.has_collection(collection_name):
            logger.warning(
                f"Collection '{collection_name}' does not exist. Skip delete_by_filters."
            )
            return 0

        try:
            def _escape(s: str) -> str:
                return s.replace('\\', '\\\\').replace('"', '\\"')

            conds = []
            for k, v in term_filters.items():
                if isinstance(v, (int, float)):
                    conds.append(f"{k} == {v}")
                else:
                    conds.append(f'{k} == "{_escape(str(v))}"')
            expr = " and ".join(conds) if conds else ""
            if not expr:
                return 0

            collection = Collection(name=collection_name, using=self.alias)
            res = collection.delete(expr)
            collection.flush()
            deleted = getattr(res, "delete_count", None)
            if deleted is None:
                logger.info(f"Delete by filters executed on '{collection_name}' with expr: {expr}")
                return 0
            logger.info(
                f"Deleted ~{int(deleted)} vectors from '{collection_name}' by filters: {term_filters}"
            )
            return int(deleted)
        except Exception as e:
            logger.error(
                f"Failed to delete by filters from '{collection_name}': {e}", exc_info=True
            )
            return 0

    def get_texts_by_ids(self, collection_name: str, ids: list[int]) -> list[dict]:
        """
        Fetch text fields for given primary key IDs from a collection.

        Returns list of {"id": int, "text": str}. Order is not guaranteed; caller may reorder.
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot fetch texts.")
            return []

        if not ids:
            return []

        if not self.has_collection(collection_name):
            logger.error(f"Collection '{collection_name}' does not exist. Cannot fetch texts.")
            return []

        try:
            collection = Collection(name=collection_name, using=self.alias)
            expr_ids = ",".join(str(int(i)) for i in ids)

            # Primary key field name may differ across legacy collections ("pk" vs "id").
            pk_field = "pk"
            try:
                pk_field = collection.schema.primary_field.name  # type: ignore[attr-defined]
            except Exception:
                pk_field = "pk"

            # Text/content field name may differ across legacy collections ("text" vs "content"/"chunk_text"...).
            content_field = "text"
            try:
                field_names = {f.name for f in (collection.schema.fields or [])}  # type: ignore[attr-defined]
                preferred = [
                    "text",
                    "chunk_text",
                    "content",
                    "chunk",
                    "document_text",
                    "raw_text",
                ]
                for cand in preferred:
                    if cand in field_names:
                        content_field = cand
                        break
                else:
                    # Pick the "largest" VARCHAR field that doesn't look like metadata.
                    exclude = {pk_field, "pk", "id", "vector", "tenant_id", "user_id", "document_name", "knowledge_base"}
                    best = None
                    for f in (collection.schema.fields or []):  # type: ignore[attr-defined]
                        try:
                            if f.name in exclude:
                                continue
                            if f.dtype != DataType.VARCHAR:
                                continue
                            ml = int(getattr(f, "max_length", 0) or 0)
                            if best is None or ml > best[0]:
                                best = (ml, f.name)
                        except Exception:
                            continue
                    if best:
                        content_field = best[1]
                if content_field != "text":
                    logger.info(
                        f"Using fallback content field '{content_field}' for collection '{collection_name}'"
                    )
            except Exception:
                content_field = "text"

            def _query_with_pk(field_name: str) -> list[dict]:
                expr = f"{field_name} in [{expr_ids}]"
                return collection.query(expr=expr, output_fields=[field_name, content_field])

            try:
                rows = _query_with_pk(pk_field)
            except Exception:
                # Fallbacks for older schemas
                if pk_field != "pk":
                    try:
                        rows = _query_with_pk("pk")
                    except Exception:
                        rows = _query_with_pk("id")
                else:
                    try:
                        rows = _query_with_pk("id")
                    except Exception:
                        rows = _query_with_pk("pk")

            results = []
            for row in rows:
                # row may be a dict with keys matching output_fields
                rid = (
                    int(row.get(pk_field))
                    if pk_field in row and row.get(pk_field) is not None
                    else (int(row.get("pk")) if row.get("pk") is not None else int(row.get("id", 0)))
                )
                results.append({"id": rid, "text": row.get(content_field, "")})
            return results
        except Exception as e:
            logger.error(f"Failed to query texts by ids from '{collection_name}': {e}", exc_info=True)
            return []

    async def search(
        self,
        collection_name: str,
        query_vector: list[float],
        top_k: int = 5,
        filter_expr: str | None = None,
    ) -> list[dict]:
        """
        Searches for similar vectors in a collection.

        Args:
            collection_name: The name of the collection to search in.
            query_vector: The query vector for similarity search.
            top_k: The number of most similar results to return.

        Returns:
            A list of search results, where each result is a dictionary
            containing the hit's ID, distance, and entity fields (e.g., text).
        """
        if not self.initialized:
            logger.error("Milvus connection not initialized. Cannot perform search.")
            return []

        if not self.has_collection(collection_name):
            logger.error(
                f"Collection '{collection_name}' does not exist. Cannot perform search."
            )
            return []

        try:
            collection = Collection(name=collection_name, using=self.alias)
            collection.load()  # Load collection into memory for searching

            search_params = {
                "metric_type": "L2",
                "params": {"nprobe": 10},
            }

            results = collection.search(
                data=[query_vector],
                anns_field="vector",
                param=search_params,
                limit=top_k,
                expr=filter_expr,
                output_fields=["text", "tenant_id", "user_id", "document_name", "knowledge_base"],  # Retrieve metadata fields
            )

            # Unload collection after search to free up memory
            collection.release()

            # Process results
            hits = results[0]  # Results for the first query vector
            search_results = []
            for hit in hits:
                search_results.append(
                    {
                        "id": hit.id,
                        "distance": hit.distance,
                        "text": hit.entity.get("text"),
                        "tenant_id": hit.entity.get("tenant_id"),
                        "user_id": hit.entity.get("user_id"),
                        "document_name": hit.entity.get("document_name"),
                        "knowledge_base": hit.entity.get("knowledge_base"),
                    }
                )

            logger.info(
                f"Search in '{collection_name}' found {len(search_results)} results."
            )
            return search_results

        except Exception as e:
            # 检查是否是维度不匹配错误
            if ("dimension mismatch" in str(e).lower() or 
                "vector dimension" in str(e).lower() or 
                "should divide the dim" in str(e).lower() or
                ("length(" in str(e).lower() and "dim(" in str(e).lower())):
                logger.warning(f"Vector dimension mismatch during search: {e}")
                try:
                    # 获取查询向量的实际维度
                    query_vector_dim = len(query_vector)
                    logger.info(f"Attempting to recreate collection with dimension {query_vector_dim}")
                    
                    # 重新创建集合
                    self.recreate_collection_with_new_dimension(collection_name, query_vector_dim)
                    
                    # 重新尝试搜索（但由于集合为空，返回空结果）
                    logger.warning(f"Collection '{collection_name}' was recreated but is now empty. Please re-upload documents.")
                    return []
                except Exception as recreate_error:
                    logger.error(f"Failed to recreate collection for search: {recreate_error}")
                    raise recreate_error
            else:
                logger.error(
                    f"Failed to search in collection '{collection_name}': {e}",
                    exc_info=True,
                )
                raise

    def get_collection_count(self, collection_name: str) -> int:
        """
        Gets the number of entities in a collection.

        Args:
            collection_name: The name of the collection.

        Returns:
            The number of entities in the collection.
        """
        if not self.initialized:
            logger.error(
                "Milvus connection not initialized. Cannot get collection count."
            )
            return 0

        if not self.has_collection(collection_name):
            logger.warning(f"Collection '{collection_name}' does not exist.")
            return 0

        try:
            collection = Collection(name=collection_name, using=self.alias)
            return collection.num_entities
        except Exception as e:
            logger.error(
                f"Failed to get count for collection '{collection_name}': {e}",
                exc_info=True,
            )
            return 0
            
    def recreate_collection_with_new_dimension(self, collection_name: str, new_dimension: int) -> bool:
        """
        重新创建集合以适应新的向量维度
        """
        try:
            # 删除现有集合
            if utility.has_collection(collection_name, using=self.alias):
                logger.info(f"Dropping existing collection '{collection_name}' to recreate with new dimension")
                self.drop_collection(collection_name)
            
            # 创建新集合
            logger.info(f"Creating new collection '{collection_name}' with dimension {new_dimension}")
            self.create_collection(collection_name, dim=new_dimension)
            
            logger.info(f"Collection '{collection_name}' recreated successfully with dimension {new_dimension}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to recreate collection '{collection_name}': {e}")
            raise


# Singleton instance of the service
milvus_service = MilvusService()
