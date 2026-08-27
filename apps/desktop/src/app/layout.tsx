import "katex/dist/katex.min.css";
import "mathlive/static.css";
import "@fontsource/m-plus-1p/400.css";
import "@fontsource/m-plus-1p/500.css";
import "@fontsource/m-plus-1p/700.css";
import "@fontsource/noto-sans-symbols/symbols-400.css";
import "@fontsource/noto-serif-jp/japanese-400.css";
import "@fontsource/noto-serif-jp/japanese-500.css";
import "@fontsource/noto-serif-jp/japanese-700.css";
import "@fontsource/stix-two-math/latin-400.css";
import "./globals.css";

import type { Metadata } from "next";

import { AppDocumentLanguage } from "@/components/AppDocumentLanguage";

import { buildContentSecurityPolicyMeta } from "./content-security-policy";

// The math box measurer registers itself from the rendering adapter barrels
// (`features/rendering/adapters/register-math-metrics.ts`). Doing it here instead does not work:
// this layout is a server component, so a module-level call runs during render on the server and
// never reaches the browser bundle the editor actually runs in.

export const metadata: Metadata = {
  title: "Sigma Studio",
  description: "SigmaDoc JSONを正本にする数学教材Webエディタ",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // CSP は静的 export (デスクトップ) にだけ焼き込む。`next dev` の HMR は `eval` と `ws:` を
  // 要求するので、開発サーバでは出さない。配送手段の選定理由は content-security-policy.ts。
  const csp = buildContentSecurityPolicyMeta(process.env.NEXT_PUBLIC_TARGET);
  return (
    <html lang="ja">
      {csp ? (
        <head>
          <meta content={csp.content} httpEquiv={csp.httpEquiv} />
        </head>
      ) : null}
      <body>
        <AppDocumentLanguage />
        {children}
      </body>
    </html>
  );
}
