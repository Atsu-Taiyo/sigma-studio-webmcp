# Sigma Studio WebMCP

Sigma Studio is a structured editor for mathematical teaching materials. Its browser version exposes the live document to compatible AI agents through WebMCP, so a person and an agent can inspect, validate, and edit the same page together.

The canonical format is SigmaDoc JSON. TeX is used inside math nodes and can also be imported into SigmaDoc. This submission build intentionally accepts document imports only from JSON (`.json`) and TeX (`.tex`, `.latex`).

## WebMCP tools

| Tool | Mode | Purpose |
|---|---|---|
| `inspect_document` | read-only | Read the title, current selection, outline, and block count |
| `read_block` | read-only | Read one block by its stable SigmaDoc ID |
| `validate_document` | read-only | Validate the current document with the canonical Zod schema |
| `insert_content` | write | Insert paragraphs, headings, or math at a controlled position |
| `replace_block_content` | write | Replace text only when the previously read content still matches |

Writes pass through the same commit function as human edits, preserving edit guards and Undo history. `replace_block_content` requires `expected_content`, preventing an agent from overwriting a newer human edit with stale state.

See [docs/webmcp.md](docs/webmcp.md) for the architecture and tool contract.

## Run locally

Requirements: Node.js 20 or newer and npm.

```sh
npm install
npm run dev
```

Open the local URL shown by Next.js in a WebMCP-capable browser.

## Verify

```sh
npm run test:webmcp
npm run typecheck
npm run build
npm run test:e2e:webmcp
```

## Source layout

```text
apps/desktop/src/components/editor/webmcp/  browser lifecycle bridge
apps/desktop/src/lib/webmcp-tools.ts        tool definitions and SigmaDoc operations
apps/desktop/src/lib/webmcp-tools.test.ts   focused tool tests
apps/desktop/tests/e2e/webmcp.spec.ts       browser-level integration test
docs/webmcp.md                              architecture and local test guide
```

## License

No project-wide license has been specified yet. Public visibility does not grant permission to copy, modify, or redistribute the project. A challenge-compatible open-source license must be selected before the final submission.
