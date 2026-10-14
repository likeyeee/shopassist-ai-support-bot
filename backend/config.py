import os
from dataclasses import dataclass, field
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[1] / '.env')


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.getenv('DATA_DIR', './data')))
    admin_token: str = field(default_factory=lambda: os.getenv('ADMIN_TOKEN', ''))
    api_key: str = field(default_factory=lambda: os.getenv('DEEPSEEK_API_KEY', ''))
    model: str = field(default_factory=lambda: os.getenv('DEEPSEEK_MODEL', 'deepseek-chat'))
    base_url: str = field(default_factory=lambda: os.getenv('DEEPSEEK_BASE_URL', 'https://api.deepseek.com'))
    embedding_model: str = field(default_factory=lambda: os.getenv('EMBEDDING_MODEL', 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2'))
    threshold: float = field(default_factory=lambda: float(os.getenv('RETRIEVAL_THRESHOLD', '0.35')))
    qdrant_url: str = field(default_factory=lambda: os.getenv('QDRANT_URL', ''))
    qdrant_key: str = field(default_factory=lambda: os.getenv('QDRANT_API_KEY', ''))
    origins: list[str] = field(default_factory=lambda: os.getenv('ALLOWED_ORIGINS', 'http://localhost:3000,http://127.0.0.1:3000').split(','))
