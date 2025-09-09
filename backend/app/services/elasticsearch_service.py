"""
Elasticsearch Service
Handles all interactions with Elasticsearch for keyword-based search.
"""

import logging
from elasticsearch import AsyncElasticsearch, NotFoundError
from elasticsearch.helpers import async_bulk
from typing import List, Dict, Any, Optional

from app.core.config import settings

logger = logging.getLogger(__name__)


class ElasticsearchService:
    """
    A singleton service for managing connections and operations with Elasticsearch.
    """

    _instance: Optional["ElasticsearchService"] = None
    _es_client: Optional[AsyncElasticsearch] = None

    @classmethod
    async def get_instance(cls) -> "ElasticsearchService":
        if cls._instance is None:
            cls._instance = ElasticsearchService()
            try:
                logger.info(
                    f"Connecting to Elasticsearch at {settings.ELASTICSEARCH_HOSTS}"
                )
                cls._es_client = AsyncElasticsearch(hosts=settings.ELASTICSEARCH_HOSTS)
                # Use client.info() for a more robust health check against modern ES versions
                info = await cls._es_client.info()
                logger.info(
                    f"Successfully connected to Elasticsearch. Version: {info['version']['number']}"
                )
            except Exception as e:
                logger.error(f"Failed to connect to Elasticsearch: {e}", exc_info=True)
                cls._es_client = None
                if cls._instance:
                    await cls._instance.close()
                cls._instance = None
                raise
        return cls._instance

    @property
    def client(self) -> AsyncElasticsearch:
        if self._es_client is None:
            raise ConnectionError("Elasticsearch client is not initialized.")
        return self._es_client

    async def close(self):
        if self._es_client:
            await self._es_client.close()
            self._es_client = None
            ElasticsearchService._instance = None
            logger.info("Elasticsearch connection closed.")

    async def index_exists(self, index_name: str) -> bool:
        """Checks if an index exists."""
        try:
            return await self.client.indices.exists(index=index_name)
        except Exception as e:
            logger.error(
                f"Error checking if index '{index_name}' exists: {e}", exc_info=True
            )
            return False

    async def create_index(self, index_name: str):
        """Creates a new index with a specific mapping for text."""
        if await self.index_exists(index_name):
            logger.warning(f"Index '{index_name}' already exists.")
            return

        body = {
            "mappings": {
                "properties": {
                    "text": {"type": "text", "analyzer": "standard"},
                }
            }
        }
        try:
            await self.client.indices.create(index=index_name, body=body)
            logger.info(
                f"Successfully created index '{index_name}' with 'standard' analyzer."
            )
        except Exception as e:
            logger.error(f"Failed to create index '{index_name}': {e}", exc_info=True)
            raise

    async def delete_index(self, index_name: str):
        """Deletes an entire index."""
        if not await self.index_exists(index_name):
            logger.warning(f"Index '{index_name}' does not exist, skipping deletion.")
            return
        try:
            await self.client.indices.delete(index=index_name)
            logger.info(f"Successfully deleted index '{index_name}'.")
        except NotFoundError:
            logger.warning(f"Index '{index_name}' not found during deletion.")
        except Exception as e:
            logger.error(f"Failed to delete index '{index_name}': {e}", exc_info=True)
            raise

    async def delete_by_query(
        self,
        index_name: str,
        term_filters: Dict[str, Any],
    ) -> int:
        """Delete documents in an index by exact-match filters.

        Args:
            index_name: Target index
            term_filters: Dict of field -> value to match (term queries)

        Returns:
            Number of deleted documents (best-effort from ES response)
        """
        if not await self.index_exists(index_name):
            logger.warning(f"Index '{index_name}' does not exist; skip delete_by_query.")
            return 0

        body = {
            "query": {
                "bool": {
                    "filter": [{"term": {k: v}} for k, v in term_filters.items()]
                }
            }
        }

        try:
            resp = await self.client.delete_by_query(
                index=index_name, body=body, conflicts="proceed", refresh=True
            )
            deleted = int(resp.get("deleted", 0))
            logger.info(
                f"Deleted {deleted} docs from '{index_name}' by filters: {term_filters}"
            )
            return deleted
        except Exception as e:
            logger.error(
                f"Failed delete_by_query on '{index_name}': {e}", exc_info=True
            )
            return 0

    async def bulk_index_documents(
        self, index_name: str, documents: List[Dict[str, Any]]
    ):
        """
        Indexes a batch of documents into the specified index.
        Each document should be a dictionary, e.g., {"text": "some content"}.
        """
        if not documents:
            return

        actions = [
            {
                "_index": index_name,
                "_source": doc,
            }
            for doc in documents
        ]

        try:
            success, errors = await async_bulk(
                self.client, actions, raise_on_error=False
            )
            if errors:
                logger.error(
                    f"Bulk indexing to '{index_name}' had {len(errors)} errors."
                )
                for error in errors[:5]:  # Log first 5 errors
                    logger.error(f"Bulk indexing error: {error}")
            logger.info(f"Successfully indexed {success} documents to '{index_name}'.")
        except Exception as e:
            logger.error(
                f"Failed to bulk index documents to '{index_name}': {e}", exc_info=True
            )
            raise

    async def search(
        self, 
        index_name: str, 
        query: str, 
        top_k: int = 5,
        filter_query: Optional[Dict[str, Any]] = None
    ) -> List[Dict[str, Any]]:
        """
        Performs a keyword search against the 'text' field with optional filtering.
        
        Args:
            index_name: The Elasticsearch index to search in
            query: The search query text
            top_k: Maximum number of results to return
            filter_query: Optional filter conditions (e.g., {"tenant_id": 1})
        
        Returns:
            List of search results with scores and text content
        """
        if not await self.index_exists(index_name):
            logger.warning(f"Cannot search in non-existent index '{index_name}'.")
            return []

        # Build the query using bool query for combining match and filter
        if filter_query:
            # Use bool query with must (for matching text) and filter (for exact matches)
            body = {
                "query": {
                    "bool": {
                        "must": [
                            {"match": {"text": query}}
                        ],
                        "filter": [
                            {"term": {key: value}} for key, value in filter_query.items()
                        ]
                    }
                },
                "size": top_k
            }
        else:
            # Simple match query when no filters
            body = {"query": {"match": {"text": query}}, "size": top_k}

        try:
            response = await self.client.search(index=index_name, body=body)
            hits = response["hits"]["hits"]
            return [
                {"score": hit["_score"], "text": hit["_source"]["text"]} for hit in hits
            ]
        except Exception as e:
            logger.error(
                f"Failed to search in index '{index_name}': {e}", exc_info=True
            )
            return []


async def get_elasticsearch_service() -> Optional[ElasticsearchService]:
    try:
        return await ElasticsearchService.get_instance()
    except Exception:
        # 返回 None 以便上层优雅降级
        return None


# This is a module-level instance that will be managed by get_instance
elasticsearch_service: Optional[ElasticsearchService] = None


async def startup_es_service():
    global elasticsearch_service
    elasticsearch_service = await get_elasticsearch_service()


async def shutdown_es_service():
    if elasticsearch_service:
        await elasticsearch_service.close()
