# Cognee memory module

Cognee is an optional persistent memory server for Hetzer. It runs as a
loopback-only MCP endpoint and keeps its relational, vector, and graph data in a
named Docker volume. It is disabled by default.

## Start

1. Set `COGNEE_LLM_API_KEY` in `.env` (or via `hetzer creds set cognee-llm-api-key`).
   The default provider is OpenAI; override the provider, model, endpoint, and embedding settings for another compatible service.
2. Run `hetzer init` to ensure Grimoire encryption is initialized.
3. Run `hetzer install cognee` and `hetzer up cognee`.
4. Run `hetzer mcp configure` to add `http://127.0.0.1:8001/mcp` to `.mcp.json`.

Cognee then exposes its own memory tools, including `remember`, `recall`,
`improve`, and `forget_memory`. Hetzer does not copy those calls through its
generic HTTP bridge.

## Local model configuration

Cognee supports Ollama for generation and embeddings. From the container, use
`host.docker.internal` so the same settings work with Docker Desktop and with
the Linux `host-gateway` mapping included in the recipe:

```dotenv
COGNEE_LLM_PROVIDER=ollama
COGNEE_LLM_MODEL=llama3.1:8b
COGNEE_LLM_ENDPOINT=http://host.docker.internal:11434/v1
COGNEE_LLM_API_KEY=ollama
COGNEE_EMBEDDING_PROVIDER=ollama
COGNEE_EMBEDDING_MODEL=nomic-embed-text:latest
COGNEE_EMBEDDING_ENDPOINT=http://host.docker.internal:11434/api/embed
COGNEE_EMBEDDING_DIMENSIONS=768
```

The pinned image publishes Linux AMD64 and ARM64 variants, so Docker Desktop on
Windows and macOS and Docker Engine on Linux can select the correct image.
