# Sigma Studio WebMCP

Sigma Studio is a structured editor for mathematical teaching materials. Its browser version exposes the live document to compatible AI agents through WebMCP, so a person and an agent can inspect, validate, and edit the same page together.

The canonical format is SigmaDoc JSON. TeX is used inside math nodes and can also be imported into SigmaDoc. This submission build intentionally accepts document imports only from JSON (`.json`) and TeX (`.tex`, `.latex`).

## WebMCP tools

The browser registers 26 tools for:

- inspecting, reading, searching, and validating the current SigmaDoc;
- building one reviewable proposal for text, problems, layout, shapes, tables, and 2D or 3D graphs;
- reading, adding, replying to, and resolving document comments.

Structural writes require `expectedRevision` and accumulate in a single proposal. The user can preview, apply, or discard that proposal in the editor. Applying it passes through the same commit function as human edits and creates one Undo boundary. If the document changed after the proposal started, Sigma Studio replays the operations over unrelated human edits and reports conflicts only for the affected targets.

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

This repository is licensed under the [MIT License](LICENSE).
