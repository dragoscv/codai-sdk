# Changelog

All notable changes to `codai-sdk` are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-23

### Added

- Initial public release.
- `chat()` — OpenAI-compatible completions with codai extensions
  (`sessionId`, `agentMode`, `compact`, `bestOf`).
- `chatStream()` — SSE streaming via async iterator.
- `agents.run()` — server-side agent loop.
- `feedback()` — thumbs rating on a completed request.
- `models()` — list models available to the key.
- `embeddings()`, `audio.transcribe()`, `audio.speech()`, `mintToken()`.
- Typed `CodaiError` with `status`, `message`, and `body`.

[Unreleased]: https://github.com/dragoscv/codai-sdk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dragoscv/codai-sdk/releases/tag/v0.1.0
