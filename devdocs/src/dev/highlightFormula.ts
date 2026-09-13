import { createHighlighterCore } from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Formula pages need one language and two themes, not Shiki's complete language catalog.
const highlighter = createHighlighterCore({
  langs: [import("@shikijs/langs/typescript")],
  themes: [import("@shikijs/themes/github-light"), import("@shikijs/themes/github-dark")],
  engine: createOnigurumaEngine(import("shiki/wasm")),
});

export async function highlightFormula(source: string): Promise<string> {
  return (await highlighter).codeToHtml(source, {
    lang: "typescript", themes: { light: "github-light", dark: "github-dark" }, defaultColor: false,
  });
}
