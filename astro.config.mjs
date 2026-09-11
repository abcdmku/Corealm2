import { defineConfig } from "astro/config";
import starlight from "@astrojs/starlight";

const base = process.env.DOCS_BASE ?? "/";
const site = process.env.DOCS_SITE_URL;
const asset = (pathname) => `${base.replace(/\/$/, "")}${pathname}` || pathname;
const socialAsset = (pathname) => site ? new URL(asset(pathname), site).href : asset(pathname);

export default defineConfig({
  srcDir: "./docs-site/src",
  publicDir: "./docs-site/public",
  outDir: "./dist",
  base,
  site,
  integrations: [
    starlight({
      title: "Corealm Codex",
      description: "Game guides generated from Corealm's live content.",
      favicon: "/favicon.svg",
      customCss: ["./docs-site/src/styles/corealm.css", "./game/src/ui/tooltip.css"],
      defaultLocale: "root",
      locales: { root: { label: "English", lang: "en" } },
      lastUpdated: true,
      social: [
        { icon: "github", label: "GitHub", href: "https://github.com/abcdmku/Corealm" },
      ],
      sidebar: [
        { label: "Start here", items: [{ label: "The Codex", link: "/" }] },
        {
          label: "World guide",
          items: [
            { label: "Guide index", link: "/game/" },
            { label: "Quests", link: "/game/quests/" },
            { label: "People", link: "/game/npcs/" },
            { label: "Creatures", link: "/game/creatures/" },
            { label: "Regions", link: "/game/regions/" },
          ],
        },
        {
          label: "Systems",
          items: [
            { label: "Items", link: "/game/items/" },
            { label: "Worn armor", link: "/game/armor/" },
            { label: "Recipes", link: "/game/recipes/" },
            { label: "Resources", link: "/game/resources/" },
            { label: "Skills", link: "/game/skills/" },
            { label: "Experience", link: "/game/experience/" },
            { label: "Spells and shops", link: "/game/spells-and-shops/" },
          ],
        },
      ],
      head: [
        { tag: "meta", attrs: { property: "og:title", content: "Corealm Codex" } },
        { tag: "meta", attrs: { property: "og:description", content: "Guides, people, creatures, quests, and regions generated from the live game." } },
        { tag: "meta", attrs: { property: "og:image", content: socialAsset("/og.png") } },
        { tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
        { tag: "script", attrs: { type: "module", src: asset("/corealm-map.js") } },
        { tag: "script", attrs: { type: "module", src: asset("/corealm-items.js") } },
      ],
    }),
  ],
});
