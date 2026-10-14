"""Upload sample policies to a running ShopAssist API using the configured admin token."""
import os
from pathlib import Path
import httpx
from dotenv import load_dotenv

root = Path(__file__).resolve().parents[1]
load_dotenv(root / '.env')
base = os.getenv('API_URL', 'http://127.0.0.1:8000/api')
with httpx.Client(timeout=300) as client:
    for path in sorted((root / 'examples').glob('*.md')):
        with path.open('rb') as file:
            response = client.post(base + '/admin/documents', headers={'Authorization': 'Bearer ' + os.environ['ADMIN_TOKEN']}, files={'file': (path.name, file, 'text/markdown')})
        if response.status_code == 409:
            print(f'{path.name}: already indexed')
        else:
            response.raise_for_status()
            print(f'{path.name}: {response.json()["chunks"]} chunks indexed')
