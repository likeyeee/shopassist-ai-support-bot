# Verification

Date: 2026-10-14 (Asia/Shanghai).

- `python -m pytest backend/tests -q`: 13 passed. Tests use a deterministic test embedder with real embedded Qdrant, and mocked provider responses.
- `npm run typecheck`: passed.
- `npm run build`: passed, static Next.js production export.
- `npm audit --omit=dev --audit-level=high`: no vulnerabilities after updating PDF.js to the patched 6.x release.
- Real API smoke test: HTTP 200 from DeepSeek. The `deepseek-chat` alias returned model `deepseek-flash`.
- Real import: three sample Markdown policies embedded by multilingual MiniLM and stored in Qdrant.
- Real two-page PDF import: two chunks indexed; a garment-storage question returned a DeepSeek answer with the exact quote attributed to page 2.
- English shipping and returns questions: generated answers with verified supporting quotations.
- Chinese question “你们的退货期限是多少天？”: correctly answered 30 days, citing the English return policy.
- “Can you refund my order #54321 right now?”: automatically created a human ticket without claiming to perform a refund.
- Browser: real shipping response, source inspection, persisted thumbs-up, admin login, and knowledge-base display verified.
- Browser: internal ticket note and resolution persisted; open ticket count updated. Mobile viewport at 390 × 844 had no horizontal overflow. Browser console returned no warning or error entries.
- A 60-second edited screen recording covers the real application; it includes held frames for readability and has no narration.

The Docker recipe is provided but was not executed on the development host, which has no Docker runtime. This is an MVP, not a production load or security certification. No credentials, runtime records, or downloaded embedding weights are included in the repository.
