// i18n-Extraktion (05.10.2026): sammelt alle deutschen Oberflächentexte aus
// src/**/*.{jsx,tsx} (JSX-Text, UI-Attribute, typische Label-Properties,
// toast-Aufrufe) nach src/i18n/quellen.json. Texte mit ${…} werden als Muster
// mit Platzhaltern {0},{1} … abgelegt. Aufruf: node scripts/i18n-extract.mjs
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";

const ROOT = process.cwd();
const SRC = join(ROOT, "src");
const ATTRS = new Set([
  "title",
  "placeholder",
  "aria-label",
  "alt",
  "label",
  "hint",
  "subtitle",
  "sub",
  "desc",
  "description",
  "tooltip",
  "emptyText",
  "empty",
  "text",
  "confirmText",
  "cancelText",
  "heading",
  "caption",
]);
const PROPS = new Set([
  "label",
  "title",
  "desc",
  "description",
  "hint",
  "placeholder",
  "tooltip",
  "sub",
  "subtitle",
  "text",
  "help",
  "empty",
  "emptyText",
  "caption",
  "heading",
  "info",
  "short",
  "long",
  "detail",
  "beschreibung",
  "titel",
  "hinweis",
  "legend",
  "unit",
  "tip",
  "cta",
  "button",
  "message",
  "msg",
]);
const CALLS = new Set([
  "toast",
  "alert",
  "confirm",
  "setError",
  "setHinweis",
  "setMsg",
  "setMeldung",
  "setStatus",
  "setInfo",
  "setNotice",
  "setFehler",
]);

function files(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    const s = statSync(p);
    if (s.isDirectory()) {
      if (
        n === "i18n" ||
        n === "integrations" ||
        n === "server" ||
        p.split("\\").join("/").endsWith("routes/api")
      )
        continue;
      files(p, out);
    } else if (
      /\.(jsx|tsx|ts)$/.test(n) &&
      !/\.(test|spec)\./.test(n) &&
      !n.endsWith(".d.ts") &&
      !n.includes(".server.") &&
      !n.endsWith(".gen.ts")
    )
      out.push(p);
  }
  return out;
}

const norm = (t) => t.replace(/\s+/g, " ").trim();
function istUiText(t, ui = false) {
  if (!t || t.length < 2 || t.length > 400) return false;
  // Einzelwörter in sichtbarem Text (JSX, Label-Props): «berechtigt», «aktuell» …
  if (
    ui &&
    /^[a-zäöüß]{3,}$/.test(t) &&
    !/^(true|false|null|undefined|none|auto|left|right|center|top|bottom|block|flex|grid|inline|hidden|pointer|default|inherit|bold|normal|small|large|button|submit|text|sans|serif)$/.test(
      t,
    )
  )
    return true;
  if (!/[A-Za-zÄÖÜäöüé]{2,}/.test(t)) return false;
  if (/^[a-z0-9_.:/#?&=%-]+$/.test(t)) return false; // ids, Pfade, Klassen
  if (/^https?:\/\//.test(t) || /^\/[a-z]/.test(t)) return false;
  if (!/\s/.test(t) && /[[\]:]/.test(t) && /^[a-z]/.test(t)) return false; // Tailwind-Klassen
  if (/^[a-z-]+(\s+[a-z0-9:[\].\/-]+)+$/.test(t) && /-/.test(t)) return false; // Klassenlisten
  if (/^[A-Z0-9_]+$/.test(t) && t.length > 1 && !/[ÄÖÜ]/.test(t) && t.length < 4) return false;
  if (/[{};]\s*$/.test(t) && /:\s*[^ ]+;/.test(t)) return false; // CSS
  if (/^(rgba?|hsl|#[0-9a-f]{3,8}|var\(|calc\()/i.test(t)) return false;
  if (/^[\d\s.,:%+\-–—/()×·]+$/.test(t)) return false;
  return true;
}

const texte = new Map(); // text -> { n, dateien:Set }
function add(t, datei, ui = false) {
  t = norm(t);
  if (!istUiText(t, ui)) return;
  const e = texte.get(t) || { n: 0, dateien: new Set() };
  e.n++;
  e.dateien.add(datei);
  texte.set(t, e);
}
function vonTemplate(node, datei) {
  // `${n} Kunden` -> "{0} Kunden"
  let s = "";
  node.quasis.forEach((q, i) => {
    s += q.value.cooked ?? q.value.raw;
    if (i < node.expressions.length) s += `{${i}}`;
  });
  const ohne = s.replace(/\{\d+\}/g, "").trim();
  if (!istUiText(ohne)) return;
  add(s, datei);
}
function wert(node, datei) {
  if (!node) return;
  if (node.type === "StringLiteral") add(node.value, datei, true);
  else if (node.type === "TemplateLiteral") vonTemplate(node, datei);
  else if (node.type === "ConditionalExpression") {
    wert(node.consequent, datei);
    wert(node.alternate, datei);
  } else if (node.type === "LogicalExpression") wert(node.right, datei);
  else if (node.type === "JSXExpressionContainer") wert(node.expression, datei);
}

// Breite Erfassung: deutsche Sätze/Begriffe auch ausserhalb von JSX (z. B. in
// Hilfsfunktionen zusammengesetzte Labels). Extra-Einträge sind harmlos — sie
// greifen nur, wenn genau dieser Text in der Oberfläche steht.
const DEUTSCH =
  /[äöüÄÖÜ]|(und|oder|der|die|das|nicht|noch|keine?|für|mit|wird|werden|bitte|fehlt|läuft|gespeichert|geladen|Kunde|Kunden|Daten|Fehler|Zeitraum|Vergleich|Messung|Freigabe|aktiv|inaktiv|offen|erledigt|Woche|Monat|Tage?n?)/;
function breit(node, datei) {
  if (node.type === "StringLiteral" && /\s/.test(node.value) && DEUTSCH.test(node.value))
    add(node.value, datei);
  else if (
    node.type === "TemplateLiteral" &&
    node.quasis.some((q) => DEUTSCH.test(q.value.cooked ?? ""))
  )
    vonTemplate(node, datei);
}

function walk(node, datei, parent) {
  if (!node || typeof node.type !== "string") return;
  if (
    (node.type === "StringLiteral" || node.type === "TemplateLiteral") &&
    parent &&
    parent.type !== "ImportDeclaration" &&
    parent.type !== "ExportNamedDeclaration" &&
    !(parent.type === "ObjectProperty" && parent.key === node) &&
    !(parent.type === "CallExpression" && parent.callee?.name === "require")
  )
    breit(node, datei);
  switch (node.type) {
    case "JSXText":
      add(node.value, datei, true);
      break;
    case "JSXExpressionContainer":
      if (parent && (parent.type === "JSXElement" || parent.type === "JSXFragment"))
        wert(node.expression, datei);
      break;
    case "JSXAttribute": {
      const n = node.name?.name;
      if (typeof n === "string" && ATTRS.has(n)) wert(node.value, datei);
      break;
    }
    case "ObjectProperty": {
      const k = node.key?.name ?? node.key?.value;
      if (typeof k === "string" && PROPS.has(k)) wert(node.value, datei);
      break;
    }
    case "CallExpression": {
      const c = node.callee;
      const name = c?.name ?? (c?.type === "MemberExpression" ? c.property?.name : null);
      if (name && CALLS.has(name)) node.arguments.slice(0, 1).forEach((a) => wert(a, datei));
      break;
    }
  }
  for (const k of Object.keys(node)) {
    if (
      k === "loc" ||
      k === "start" ||
      k === "end" ||
      k === "leadingComments" ||
      k === "trailingComments"
    )
      continue;
    const v = node[k];
    if (Array.isArray(v)) v.forEach((c) => c && typeof c.type === "string" && walk(c, datei, node));
    else if (v && typeof v.type === "string") walk(v, datei, node);
  }
}

for (const f of files(SRC)) {
  const code = readFileSync(f, "utf8");
  let ast;
  try {
    ast = parse(code, {
      sourceType: "module",
      plugins: ["jsx", "typescript"],
      errorRecovery: true,
    });
  } catch (e) {
    console.warn("Parse-Fehler", relative(ROOT, f), e.message);
    continue;
  }
  walk(ast.program, relative(ROOT, f).replace(/\\/g, "/"), null);
}

const liste = [...texte.entries()]
  .sort((a, b) => a[0].localeCompare(b[0], "de"))
  .map(([t, e]) => t);
mkdirSync(join(SRC, "i18n"), { recursive: true });
writeFileSync(join(SRC, "i18n", "quellen.json"), JSON.stringify(liste, null, 1) + "\n");
console.log(`${liste.length} Texte (${liste.filter((t) => /\{\d+\}/.test(t)).length} Muster)`);
