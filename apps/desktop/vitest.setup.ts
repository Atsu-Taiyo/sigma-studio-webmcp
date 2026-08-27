import { registerOverlayMathMetricsPort } from "@/features/rendering/adapters";

// Registers the real (KaTeX/MathLive-backed) math box measurer for every test in this project,
// matching every real entry point (editor, print route, MCP server, Electron main), all of which
// register it too. Without this, `measureOverlayText` would silently exercise its last-resort
// no-port fallback across the whole suite instead of the path production actually runs -- tests
// that specifically want the fallback (or a hand-built fake port) pass one explicitly per-call.
registerOverlayMathMetricsPort();

// happy-dom を使うテスト (`// @vitest-environment happy-dom`) では `navigator.language` が
// "en-US" になる。エディタは保存値が無ければブラウザロケールに従うので、何もしないと
// UI テストだけが英語で描かれてしまう。既定 (node 環境) と同じ日本語に固定する。
//
// **無条件に差し替える**。「無ければ用意する」という条件では駄目で、この環境の window は
// `localStorage` というキーを持ちながら値が undefined なので、`in` での判定は素通りして
// 静かに英語のままになる (`src/lib/i18n/vitest-locale-pin.test.tsx` が実測で守っている)。
// ロケール自体を検証するテストは自前で差し替えるので影響しない (configurable)。
if (typeof window !== "undefined") {
  const entries = new Map<string, string>([["sigma-studio:ui-locale", "ja"]]);
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string): string | null => entries.get(key) ?? null,
      setItem: (key: string, value: string): void => {
        entries.set(key, value);
      },
      removeItem: (key: string): void => {
        entries.delete(key);
      },
      clear: (): void => {
        entries.clear();
      },
    },
  });
}
