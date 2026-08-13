import {
  createHighlighterCore,
  createCssVariablesTheme,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createOnigurumaEngine } from "shiki/engine/oniguruma";

// Singleton highlighter instance
let highlighter: HighlighterCore | null = null;
let highlighterPromise: Promise<HighlighterCore> | null = null;
const loadedLanguages = new Set<string>();
const failedLanguages = new Set<string>();

/**
 * CSS Variables theme for Shiki
 * Maps TextMate scopes to CSS variable names that reference our theme system.
 */
const cssVarsTheme = createCssVariablesTheme({
  name: "css-variables",
  variablePrefix: "--shiki-",
  variableDefaults: {
    foreground: "var(--shiki-color-text)",
    background: "var(--shiki-color-background)",
  },
  fontStyle: true,
});

/**
 * Language alias mapping (file extensions and common names to Shiki IDs)
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  // JavaScript family
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  mjs: "javascript",
  cjs: "javascript",
  // Python
  py: "python",
  pyw: "python",
  // Ruby
  rb: "ruby",
  // Rust
  rs: "rust",
  // Go
  go: "go",
  // Shell
  sh: "bash",
  bash: "bash",
  shell: "bash",
  zsh: "bash",
  fish: "fish",
  // Config/Data
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  ini: "ini",
  // JSON
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  // Markdown
  md: "markdown",
  mdx: "mdx",
  // CSS
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  // HTML/XML
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  // SQL
  sql: "sql",
  // C family
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  // C#
  cs: "csharp",
  csharp: "csharp",
  // Java/JVM
  java: "java",
  kt: "kotlin",
  kotlin: "kotlin",
  scala: "scala",
  groovy: "groovy",
  // Apple
  swift: "swift",
  objc: "objective-c",
  // PHP
  php: "php",
  // Lua
  lua: "lua",
  // Vim
  vim: "viml",
  // Docker
  dockerfile: "dockerfile",
  docker: "dockerfile",
  // Make
  makefile: "makefile",
  make: "makefile",
  // Diff/Patch
  diff: "diff",
  patch: "diff",
  // Blockchain
  sol: "solidity",
  solidity: "solidity",
  // Zig
  zig: "zig",
  // Functional
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  ml: "ocaml",
  clj: "clojure",
  cljs: "clojure",
  // GraphQL
  graphql: "graphql",
  gql: "graphql",
  // Protocol Buffers
  proto: "protobuf",
  // Nix
  nix: "nix",
  // Terraform
  tf: "hcl",
  hcl: "hcl",
  // PowerShell
  ps1: "powershell",
  psm1: "powershell",
  // R
  r: "r",
  // Perl
  pl: "perl",
  pm: "perl",
  // LaTeX
  tex: "latex",
  latex: "latex",
  // WASM
  wat: "wasm",
  wasm: "wasm",
};

/**
 * Core languages to preload (most commonly used in Grimoire)
 */
const CORE_LANGUAGES = [
  "javascript",
  "typescript",
  "json",
  "html",
  "css",
  "diff",
  "bash",
  "rust",
  "toml",
  "markdown",
] as const;

type LanguageLoader = () => Promise<{ default: LanguageRegistration[] }>;

/**
 * Grammars we ship, one lazy chunk each.
 *
 * Deliberately an allowlist rather than shiki's `bundledLanguages` registry:
 * that pulls all ~200 grammars into the build. Every entry here is a target of
 * LANGUAGE_ALIASES above — keep the two in sync when adding a language. The
 * import specifiers must stay literal so Vite can statically analyze them.
 */
const LANGUAGE_LOADERS: Record<string, LanguageLoader> = {
  bash: () => import("shiki/langs/bash.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  clojure: () => import("shiki/langs/clojure.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  dockerfile: () => import("shiki/langs/dockerfile.mjs"),
  elixir: () => import("shiki/langs/elixir.mjs"),
  erlang: () => import("shiki/langs/erlang.mjs"),
  fish: () => import("shiki/langs/fish.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  graphql: () => import("shiki/langs/graphql.mjs"),
  groovy: () => import("shiki/langs/groovy.mjs"),
  haskell: () => import("shiki/langs/haskell.mjs"),
  hcl: () => import("shiki/langs/hcl.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  ini: () => import("shiki/langs/ini.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  json5: () => import("shiki/langs/json5.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  kotlin: () => import("shiki/langs/kotlin.mjs"),
  latex: () => import("shiki/langs/latex.mjs"),
  less: () => import("shiki/langs/less.mjs"),
  lua: () => import("shiki/langs/lua.mjs"),
  makefile: () => import("shiki/langs/makefile.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  mdx: () => import("shiki/langs/mdx.mjs"),
  nix: () => import("shiki/langs/nix.mjs"),
  "objective-c": () => import("shiki/langs/objective-c.mjs"),
  ocaml: () => import("shiki/langs/ocaml.mjs"),
  perl: () => import("shiki/langs/perl.mjs"),
  php: () => import("shiki/langs/php.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  protobuf: () => import("shiki/langs/protobuf.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  r: () => import("shiki/langs/r.mjs"),
  ruby: () => import("shiki/langs/ruby.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  sass: () => import("shiki/langs/sass.mjs"),
  scala: () => import("shiki/langs/scala.mjs"),
  scss: () => import("shiki/langs/scss.mjs"),
  solidity: () => import("shiki/langs/solidity.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  swift: () => import("shiki/langs/swift.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  typescript: () => import("shiki/langs/typescript.mjs"),
  viml: () => import("shiki/langs/viml.mjs"),
  wasm: () => import("shiki/langs/wasm.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  zig: () => import("shiki/langs/zig.mjs"),
};

/**
 * Normalize language identifier to Shiki language ID
 */
export function normalizeLanguage(lang: string | null | undefined): string {
  if (!lang) return "text";
  const normalized = lang.toLowerCase().trim();
  return LANGUAGE_ALIASES[normalized] || normalized;
}

/**
 * Get or create the singleton highlighter instance
 */
export async function getHighlighter(): Promise<HighlighterCore> {
  if (highlighter) return highlighter;

  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [cssVarsTheme],
      langs: CORE_LANGUAGES.map((l) => LANGUAGE_LOADERS[l]()),
      engine: createOnigurumaEngine(import("shiki/wasm")),
    }).then((hl) => {
      highlighter = hl;
      CORE_LANGUAGES.forEach((l) => loadedLanguages.add(l));
      return hl;
    });
  }

  return highlighterPromise;
}

/**
 * Load a language on demand
 */
async function loadLanguage(lang: string): Promise<boolean> {
  if (lang === "text" || loadedLanguages.has(lang)) return true;
  if (failedLanguages.has(lang)) return false;

  const hl = await getHighlighter();

  try {
    const loader = LANGUAGE_LOADERS[lang];
    if (!loader) {
      failedLanguages.add(lang);
      return false;
    }
    const langModule = await loader();
    await hl.loadLanguage(langModule.default || langModule);
    loadedLanguages.add(lang);
    return true;
  } catch {
    // Language not available - track to avoid repeated warnings
    failedLanguages.add(lang);
    console.warn(
      `[shiki] Language "${lang}" not available, falling back to plaintext`,
    );
    return false;
  }
}

/**
 * Highlight code with lazy language loading
 * Returns HTML string with CSS classes for styling via CSS variables
 */
export async function highlightCode(
  code: string,
  language: string | null | undefined,
): Promise<string> {
  const lang = normalizeLanguage(language);
  const hl = await getHighlighter();

  // Try to load the language if not already loaded
  const loaded = await loadLanguage(lang);
  const effectiveLang = loaded ? lang : "text";

  return hl.codeToHtml(code, {
    lang: effectiveLang,
    theme: "css-variables",
  });
}

/**
 * Check if a language is loaded
 */
export function isLanguageLoaded(lang: string): boolean {
  return loadedLanguages.has(normalizeLanguage(lang));
}

/**
 * Preload languages (e.g., before rendering known content)
 */
export async function preloadLanguages(langs: string[]): Promise<void> {
  await getHighlighter();
  await Promise.all(langs.map((l) => loadLanguage(normalizeLanguage(l))));
}
