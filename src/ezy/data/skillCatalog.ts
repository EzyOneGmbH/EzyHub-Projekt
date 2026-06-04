// AUTO-GENERATED skill catalog from installed plugins (claude-seo, claude-blog, claude-obsidian).
// Each entry becomes a generic tool tile routed through /api/agent/run with a single free-text input.
// Regenerate by re-running the generator; do not hand-edit individual entries.

export type SkillCatalogEntry = {
  id: string;
  skill: string;
  label: string;
  plugin: string;
  category: string;
  description: string;
  note: string | null;
};

export const SKILL_CATALOG: SkillCatalogEntry[] = [
  {
    "id": "skill:seo",
    "skill": "seo",
    "label": "seo",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Comprehensive SEO analysis for any website or business type.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:seo-audit",
    "skill": "seo-audit",
    "label": "seo-audit",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Full website SEO audit with parallel subagent delegation.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:seo-backlinks",
    "skill": "seo-backlinks",
    "label": "seo-backlinks",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Backlink profile analysis: referring domains, anchor text distribution, toxic link detection, competitor gap analysis.",
    "note": null
  },
  {
    "id": "skill:seo-cluster",
    "skill": "seo-cluster",
    "label": "seo-cluster",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "SERP-based semantic topic clustering for content architecture planning.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:seo-competitor-pages",
    "skill": "seo-competitor-pages",
    "label": "seo-competitor-pages",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Generate SEO-optimized competitor comparison and alternatives pages.",
    "note": null
  },
  {
    "id": "skill:seo-content",
    "skill": "seo-content",
    "label": "seo-content",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Content quality and E-E-A-T analysis with AI citation readiness assessment.",
    "note": null
  },
  {
    "id": "skill:seo-content-brief",
    "skill": "seo-content-brief",
    "label": "seo-content-brief",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Generate competitive SEO content briefs with per-section word counts, competitor scoring, keyword density guidance, and page-type templates.",
    "note": null
  },
  {
    "id": "skill:seo-dataforseo",
    "skill": "seo-dataforseo",
    "label": "seo-dataforseo",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Live SEO data via DataForSEO MCP server.",
    "note": "benötigt DataForSEO"
  },
  {
    "id": "skill:seo-drift",
    "skill": "seo-drift",
    "label": "seo-drift",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "SEO drift monitoring: capture baselines of SEO-critical elements, detect changes, and track regressions over time.",
    "note": null
  },
  {
    "id": "skill:seo-ecommerce",
    "skill": "seo-ecommerce",
    "label": "seo-ecommerce",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "E-commerce SEO analysis: Google Shopping visibility, Amazon marketplace intelligence, product schema validation, competitor pricing analysis, and marketplace ke",
    "note": "benötigt DataForSEO"
  },
  {
    "id": "skill:seo-flow",
    "skill": "seo-flow",
    "label": "seo-flow",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "FLOW framework integration — evidence-led SEO using the Find → Leverage → Optimize → Win loop.",
    "note": null
  },
  {
    "id": "skill:seo-geo",
    "skill": "seo-geo",
    "label": "seo-geo",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Optimize content for AI Overviews (formerly SGE), ChatGPT web search, Perplexity, and other AI-powered search experiences.",
    "note": null
  },
  {
    "id": "skill:seo-google",
    "skill": "seo-google",
    "label": "seo-google",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Google SEO APIs: Search Console (Search Analytics, URL Inspection, Sitemaps), PageSpeed Insights v5, CrUX field data with 25-week history, Indexing API v3, and",
    "note": "benötigt Google-API"
  },
  {
    "id": "skill:seo-hreflang",
    "skill": "seo-hreflang",
    "label": "seo-hreflang",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Hreflang and international SEO audit, validation, and generation.",
    "note": null
  },
  {
    "id": "skill:seo-image-gen",
    "skill": "seo-image-gen",
    "label": "seo-image-gen",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "AI image generation for SEO assets: OG/social preview images, blog hero images, schema images, product photography, infographics.",
    "note": "benötigt Gemini-Bild-API"
  },
  {
    "id": "skill:seo-images",
    "skill": "seo-images",
    "label": "seo-images",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Image optimization analysis for SEO and performance.",
    "note": "benötigt teilw. DataForSEO"
  },
  {
    "id": "skill:seo-local",
    "skill": "seo-local",
    "label": "seo-local",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Local SEO analysis covering Google Business Profile optimization, NAP consistency, citation health, review signals, local schema markup, location page quality,",
    "note": "benötigt teilw. DataForSEO"
  },
  {
    "id": "skill:seo-maps",
    "skill": "seo-maps",
    "label": "seo-maps",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Maps intelligence for local SEO — geo-grid rank tracking, GBP profile auditing via API, review intelligence across Google/Tripadvisor/Trustpilot, cross-platform",
    "note": "benötigt DataForSEO"
  },
  {
    "id": "skill:seo-page",
    "skill": "seo-page",
    "label": "seo-page",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Deep single-page SEO analysis covering on-page elements, content quality, technical meta tags, schema, images, and performance.",
    "note": null
  },
  {
    "id": "skill:seo-plan",
    "skill": "seo-plan",
    "label": "seo-plan",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Strategic SEO planning for new or existing websites.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:seo-programmatic",
    "skill": "seo-programmatic",
    "label": "seo-programmatic",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Programmatic SEO planning and analysis for pages generated at scale from data sources.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:seo-schema",
    "skill": "seo-schema",
    "label": "seo-schema",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Detect, validate, and generate Schema.org structured data.",
    "note": null
  },
  {
    "id": "skill:seo-sitemap",
    "skill": "seo-sitemap",
    "label": "seo-sitemap",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Analyze existing XML sitemaps or generate new ones with industry templates.",
    "note": null
  },
  {
    "id": "skill:seo-sxo",
    "skill": "seo-sxo",
    "label": "seo-sxo",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Search Experience Optimization: reads Google SERPs backwards to detect page-type mismatches, derives user stories from search intent signals, and scores pages f",
    "note": null
  },
  {
    "id": "skill:seo-technical",
    "skill": "seo-technical",
    "label": "seo-technical",
    "plugin": "claude-seo",
    "category": "skills-seo",
    "description": "Technical SEO audit across 9 categories: crawlability, indexability, security, URL structure, mobile, Core Web Vitals, structured data, JavaScript rendering, an",
    "note": null
  },
  {
    "id": "skill:blog",
    "skill": "blog",
    "label": "blog",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Full-lifecycle blog engine with 30 sub-skills, 12 content templates, 5-category 100-point scoring, and 5 specialized agents.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:blog-analyze",
    "skill": "blog-analyze",
    "label": "blog-analyze",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Audit and score blog posts on a 5-category 100-point scoring system covering content quality, SEO optimization, E-E-A-T signals, technical elements, and AI cita",
    "note": null
  },
  {
    "id": "skill:blog-audio",
    "skill": "blog-audio",
    "label": "blog-audio",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Generate audio narration of blog posts using Google Gemini TTS.",
    "note": "benötigt Gemini-TTS"
  },
  {
    "id": "skill:blog-audit",
    "skill": "blog-audit",
    "label": "blog-audit",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Full-site blog health assessment scanning all blog files for quality scores, orphan pages, topic cannibalization, stale content, and AI citation readiness.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:blog-brand",
    "skill": "blog-brand",
    "label": "blog-brand",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Establish durable brand and voice context for cross-skill consumption.",
    "note": null
  },
  {
    "id": "skill:blog-brief",
    "skill": "blog-brief",
    "label": "blog-brief",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Generate detailed content briefs for blog posts with target keywords, content outlines, competitive analysis, recommended statistics, image and chart suggestion",
    "note": null
  },
  {
    "id": "skill:blog-calendar",
    "skill": "blog-calendar",
    "label": "blog-calendar",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Generate editorial calendars for blogs with topic clusters, publishing schedules, content decay detection, freshness update plans, seasonal opportunities, conte",
    "note": null
  },
  {
    "id": "skill:blog-cannibalization",
    "skill": "blog-cannibalization",
    "label": "blog-cannibalization",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Detect keyword cannibalization across blog posts by extracting primary keywords from titles and headings, clustering semantically similar targets, and flagging",
    "note": null
  },
  {
    "id": "skill:blog-chart",
    "skill": "blog-chart",
    "label": "blog-chart",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Generate dark-mode-compatible inline SVG data visualization charts for blog posts.",
    "note": null
  },
  {
    "id": "skill:blog-cluster",
    "skill": "blog-cluster",
    "label": "blog-cluster",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Semantic topic cluster planning and automated execution engine for claude-blog.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:blog-discourse",
    "skill": "blog-discourse",
    "label": "blog-discourse",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Research what people are actually saying about a topic in the last 30 days across Reddit, X / Twitter, YouTube, Hacker News, dev.to, Medium, and other public di",
    "note": null
  },
  {
    "id": "skill:blog-factcheck",
    "skill": "blog-factcheck",
    "label": "blog-factcheck",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Verify statistics and claims in blog posts by fetching cited source URLs and checking if the claimed data actually appears on the page.",
    "note": null
  },
  {
    "id": "skill:blog-flow",
    "skill": "blog-flow",
    "label": "blog-flow",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "FLOW framework integration for bloggers.",
    "note": null
  },
  {
    "id": "skill:blog-geo",
    "skill": "blog-geo",
    "label": "blog-geo",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "AI citation readiness audit ONLY (does not touch Google rankings, use blog-rewrite for combined Google+AI work).",
    "note": null
  },
  {
    "id": "skill:blog-google",
    "skill": "blog-google",
    "label": "blog-google",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Google API integration for blog performance: PageSpeed Insights, CrUX Core Web Vitals with 25-week history, Search Console performance, URL Inspection, Indexing",
    "note": "benötigt Google-API"
  },
  {
    "id": "skill:blog-image",
    "skill": "blog-image",
    "label": "blog-image",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "AI image generation and editing for blog content powered by Gemini via MCP.",
    "note": "benötigt Gemini-Bild-API"
  },
  {
    "id": "skill:blog-locale-audit",
    "skill": "blog-locale-audit",
    "label": "blog-locale-audit",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Audit a directory of multilingual blog content for completeness, consistency, hreflang correctness, meta-tag parity, and freshness.",
    "note": null
  },
  {
    "id": "skill:blog-localize",
    "skill": "blog-localize",
    "label": "blog-localize",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Cultural adaptation for translated content.",
    "note": null
  },
  {
    "id": "skill:blog-multilingual",
    "skill": "blog-multilingual",
    "label": "blog-multilingual",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "One-command multilingual blog creation.",
    "note": "langer Lauf"
  },
  {
    "id": "skill:blog-notebooklm",
    "skill": "blog-notebooklm",
    "label": "blog-notebooklm",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Query Google NotebookLM notebooks for source-grounded, citation-backed answers from user-uploaded documents.",
    "note": "benötigt NotebookLM-Login"
  },
  {
    "id": "skill:blog-outline",
    "skill": "blog-outline",
    "label": "blog-outline",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "SERP-informed outline generation with H2/H3 heading hierarchy, competitive content gap analysis, section-by-section word count targets, chart and image placemen",
    "note": null
  },
  {
    "id": "skill:blog-persona",
    "skill": "blog-persona",
    "label": "blog-persona",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Create and manage writing personas with NNGroup 4-dimension tone framework (Funny-Serious, Formal-Casual, Respectful-Irreverent, Enthusiastic-Matter-of-fact).",
    "note": null
  },
  {
    "id": "skill:blog-repurpose",
    "skill": "blog-repurpose",
    "label": "blog-repurpose",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Repurpose blog posts for social media, email, YouTube, Reddit, and LinkedIn.",
    "note": null
  },
  {
    "id": "skill:blog-rewrite",
    "skill": "blog-rewrite",
    "label": "blog-rewrite",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Rewrite and optimize existing blog posts for Google rankings (December 2025 Core Update, E-E-A-T) and AI citations (GEO/AEO).",
    "note": null
  },
  {
    "id": "skill:blog-schema",
    "skill": "blog-schema",
    "label": "blog-schema",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Generate complete JSON-LD schema markup for blog posts including BlogPosting, Person, Organization, BreadcrumbList, FAQPage, and ImageObject.",
    "note": null
  },
  {
    "id": "skill:blog-seo-check",
    "skill": "blog-seo-check",
    "label": "blog-seo-check",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Post-writing SEO validation with pass/fail checklist covering title tag length and keyword placement, meta description quality, heading hierarchy and keyword de",
    "note": null
  },
  {
    "id": "skill:blog-strategy",
    "skill": "blog-strategy",
    "label": "blog-strategy",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Blog strategy development including topic cluster architecture with hub-and-spoke design, audience mapping, competitive landscape analysis, AI citation surface",
    "note": null
  },
  {
    "id": "skill:blog-taxonomy",
    "skill": "blog-taxonomy",
    "label": "blog-taxonomy",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Extract, suggest, and sync tags and categories for blog posts across all major CMS platforms.",
    "note": "benötigt CMS-API"
  },
  {
    "id": "skill:blog-translate",
    "skill": "blog-translate",
    "label": "blog-translate",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Translate existing blog posts into one or more target languages with SEO-optimized localization.",
    "note": null
  },
  {
    "id": "skill:blog-write",
    "skill": "blog-write",
    "label": "blog-write",
    "plugin": "claude-blog",
    "category": "skills-blog",
    "description": "Write new blog articles from scratch optimized for Google rankings and AI citations.",
    "note": null
  },
  {
    "id": "skill:autoresearch",
    "skill": "autoresearch",
    "label": "autoresearch",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Autonomous iterative research loop.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:canvas",
    "skill": "canvas",
    "label": "canvas",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Visual layer of the wiki. Add images, text cards, PDFs, and wiki pages to Obsidian canvas files with auto-positioning inside zones. Integrates with /banana for",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:defuddle",
    "skill": "defuddle",
    "label": "defuddle",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Strip clutter from web pages before ingesting into the wiki.",
    "note": null
  },
  {
    "id": "skill:obsidian-bases",
    "skill": "obsidian-bases",
    "label": "obsidian-bases",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Create and edit Obsidian Bases (.base files): Obsidian's native database layer for dynamic tables, card views, list views, filters, formulas, and summaries over",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:obsidian-markdown",
    "skill": "obsidian-markdown",
    "label": "obsidian-markdown",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Write correct Obsidian Flavored Markdown: wikilinks, embeds, callouts, properties, tags, highlights, math, and canvas syntax.",
    "note": null
  },
  {
    "id": "skill:save",
    "skill": "save",
    "label": "save",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Save the current conversation, answer, or insight into the Obsidian wiki vault as a structured note.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:think",
    "skill": "think",
    "label": "think",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Apply the 10-principle thinking loop (OBSERVE-OBSERVE-LISTEN-THINK-CONNECT-CONNECT-FEEL-ACCEPT-CREATE-GROW) to any non-trivial problem.",
    "note": null
  },
  {
    "id": "skill:wiki",
    "skill": "wiki",
    "label": "wiki",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Claude + Obsidian knowledge companion.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-cli",
    "skill": "wiki-cli",
    "label": "wiki-cli",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Default vault-mutation transport for claude-obsidian v1.7+.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-fold",
    "skill": "wiki-fold",
    "label": "wiki-fold",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Rollup of wiki log entries into meta-pages.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-ingest",
    "skill": "wiki-ingest",
    "label": "wiki-ingest",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Ingest sources into the Obsidian wiki vault.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-lint",
    "skill": "wiki-lint",
    "label": "wiki-lint",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Health check the Obsidian wiki vault.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-mode",
    "skill": "wiki-mode",
    "label": "wiki-mode",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Methodology modes for the Compound Vault.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-query",
    "skill": "wiki-query",
    "label": "wiki-query",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Answer questions using the Obsidian wiki vault.",
    "note": "lokaler Vault"
  },
  {
    "id": "skill:wiki-retrieve",
    "skill": "wiki-retrieve",
    "label": "wiki-retrieve",
    "plugin": "claude-obsidian",
    "category": "skills-obsidian",
    "description": "Hybrid retrieval primitive for the Compound Vault.",
    "note": "lokaler Vault"
  }
];
