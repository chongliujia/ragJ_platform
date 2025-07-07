"""
This module provides a service for interacting with the Milvus vector database.
"""
import logging
from pymilvus import utility, connections, Collection, CollectionSchema, FieldSchema, DataType, db
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
        if not hasattr(self, 'initialized'):
            self.alias = "default"
            self.db_name = settings.MILVUS_DATABASE
            try:
                # First, connect to the default database to check/create the target database
                logger.info("Connecting to Milvus default database to ensure target DB exists...")
                connections.connect(
                    alias="db_check",
                    host=settings.MILVUS_HOST,
                    port=settings.MILVUS_PORT,
                    user=settings.MILVUS_USER,
                    password=settings.MILVUS_PASSWORD,
                )
                
                existing_databases = db.list_database(using="db_check")
                if self.db_name not in existing_databases:
                    logger.warning(f"Database '{self.db_name}' not found. Creating it now...")
                    db.create_database(self.db_name, using="db_check")
                    logger.info(f"Database '{self.db_name}' created successfully.")
                
                connections.disconnect("db_check")
                logger.info("Disconnected from default database.")

                # Now, connect to the target database
                logger.info(f"Connecting to Milvus at {settings.MILVUS_HOST}:{settings.MILVUS_PORT}, DB: '{self.db_name}'")
                connections.connect(
                    alias=self.alias,
                    host=settings.MILVUS_HOST,
                    port=settings.MILVUS_PORT,
                    user=settings.MILVUS_USER,
                    password=settings.MILVUS_PASSWORD,
                    db_name=self.db_name
                )
                logger.info("Successfully connected to Milvus target database.")
                self.initialized = True
            except Exception as e:
                logger.error(f"Failed to connect to Milvus: {e}", exc_info=True)
                self.initialized = False
                # Depending on the application's needs, you might want to raise the exception
                # or handle it in a way that allows the app to run without Milvus.
                raise

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
            logger.error(f"Failed to check for collection {collection_name}: {e}", exc_info=True)
            return False

    def create_collection(self, collection_name: str, dim: int = settings.EMBEDDING_DIMENSION):
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
            pk_field = FieldSchema(name="pk", dtype=DataType.INT64, is_primary=True, auto_id=True)
            # Original text chunk
            text_field = FieldSchema(name="text", dtype=DataType.VARCHAR, max_length=65535)
            # Vector embedding
            vector_field = FieldSchema(name="vector", dtype=DataType.FLOAT_VECTOR, dim=dim)
            
            schema = CollectionSchema(fields=[pk_field, text_field, vector_field], description=f"{collection_name} collection")
            
            collection = Collection(name=collection_name, schema=schema, using=self.alias)
            logger.info(f"Successfully created collection: {collection_name}")

            # Create an index for the vector field
            index_params = {
                "metric_type": "L2",
                "index_type": "IVF_FLAT",
                "params": {"nlist": 1024}
            }
            collection.create_index(field_name="vector", index_params=index_params)
            logger.info(f"Successfully created index for collection: {collection_name}")

        except Exception as e:
            logger.error(f"Failed to create collection or index for '{collection_name}': {e}", exc_info=True)
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
            logger.error(f"Failed to drop collection '{collection_name}': {e}", exc_info=True)
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
            logger.error(f"Collection '{collection_name}' does not exist. Cannot insert data.")
            return []

        try:
            collection = Collection(name=collection_name, using=self.alias)
            # The 'entities' should be a list of lists, matching the field order.
            # Example: data = [ ["text1", "text2"], [ [vec1], [vec2] ] ]
            # Let's prepare the data in the correct format.
            texts = [entity['text'] for entity in entities]
            vectors = [entity['vector'] for entity in entities]
            data_to_insert = [texts, vectors]

            result = collection.insert(data_to_insert)
            collection.flush()  # Ensure data is indexed
            logger.info(f"Successfully inserted {len(entities)} entities into '{collection_name}'.")
            return result.primary_keys
        except Exception as e:
            logger.error(f"Failed to insert data into '{collection_name}': {e}", exc_info=True)
            raise

    def search(self, collection_name: str, query_vector: list[float], top_k: int = 5) -> list[dict]:
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
            logger.error(f"Collection '{collection_name}' does not exist. Cannot perform search.")
            return []

        try:
            collection = Collection(name=collection_name, using=self.alias)
            collection.load() # Load collection into memory for searching

            search_params = {
                "metric_type": "L2",
                "params": {"nprobe": 10},
            }

            results = collection.search(
                data=[query_vector],
                anns_field="vector",
                param=search_params,
                limit=top_k,
                output_fields=["text"]  # Retrieve the original text field
            )

            # Unload collection after search to free up memory
            collection.release()

            # Process results
            hits = results[0]  # Results for the first query vector
            search_results = []
            for hit in hits:
                search_results.append({
                    "id": hit.id,
                    "distance": hit.distance,
                    "text": hit.entity.get('text')
                })
            
            logger.info(f"Search in '{collection_name}' found {len(search_results)} results.")
            return search_results

        except Exception as e:
            logger.error(f"Failed to search in collection '{collection_name}': {e}", exc_info=True)
            raise


# Singleton instance of the service
milvus_service = MilvusService() 