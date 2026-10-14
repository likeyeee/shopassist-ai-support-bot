"""Create private local configuration without putting credentials in source control."""
from pathlib import Path
import secrets

root = Path(__file__).resolve().parents[1]
target = root / '.env'
if target.exists():
    print('.env already exists; left unchanged.')
else:
    content = (root / '.env.example').read_text(encoding='utf-8')
    content = content.replace('replace-with-a-random-token-of-at-least-24-characters', secrets.token_urlsafe(36))
    target.write_text(content, encoding='utf-8')
    print('Created .env with a random admin token. Add DEEPSEEK_API_KEY, then start the API.')
