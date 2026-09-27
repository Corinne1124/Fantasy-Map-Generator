// Runtime localization: English source strings stay in code and double as dictionary keys
import { zhCN } from "@/i18n/locales/zh-CN";

export type Locale = "en" | "zh-CN";

export const LOCALES: ReadonlyArray<{ id: Locale; label: string }> = [
  { id: "zh-CN", label: "简体中文" },
  { id: "en", label: "English" }
];

const DICTIONARIES: Record<Locale, Record<string, string>> = { en: {}, "zh-CN": zhCN };

/** Translated attributes of any element; text nodes are handled separately */
const TRANSLATED_ATTRIBUTES = ["title", "placeholder", "aria-label", "alt", "data-tip", "data-main"];
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const STORAGE_KEY = "fmg-locale";
const PLACEHOLDER = /\$\{([^}]*)\}/g;
const INTERPOLATION = /\$(\d+)/g;
const WORD = /[A-Za-z]{4,}/g;

interface Pattern {
  regex: RegExp;
  template: string;
}

// Compiled from dictionary keys that carry ${...} placeholders, indexed by each literal word they contain
const patternIndex = new Map<string, Pattern[]>();

const textSource = new WeakMap<Text, string>();
const appliedText = new WeakMap<Text, string>();
const attributeSource = new WeakMap<Element, Map<string, string>>();
const appliedAttribute = new WeakMap<Element, Map<string, string>>();

let locale: Locale = "en";
let observer: MutationObserver | undefined;

compilePatterns(zhCN);

// SVG holds the map itself: world data, never interface copy. A text node has no namespace of
// its own, so it inherits the answer from the element that contains it
function isSvgNode(node: Node): boolean {
  if (node.nodeType === Node.ELEMENT_NODE) return (node as Element).namespaceURI === SVG_NAMESPACE;
  return node.parentElement?.namespaceURI === SVG_NAMESPACE;
}

// Standard HTML opt-out: content that names languages, or any copy the app must keep verbatim
const OPT_OUT = '[translate="no"]';

function optedOut(node: Node): boolean {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
  return Boolean(element?.closest(OPT_OUT));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compilePatterns(dictionary: Record<string, string>): void {
  patternIndex.clear();

  for (const [source, translation] of Object.entries(dictionary)) {
    if (!source.includes("${")) continue;

    // captures replace placeholders positionally, so the translation becomes a $1..$n template
    let group = 0;
    const template = translation.replace(PLACEHOLDER, () => `$${++group}`);

    let cursor = 0;
    let regexSource = "^";
    const anchors: string[] = [];
    PLACEHOLDER.lastIndex = 0;

    let match = PLACEHOLDER.exec(source);
    while (match) {
      const literal = source.slice(cursor, match.index);
      regexSource += escapeRegExp(literal);
      for (const word of literal.match(WORD) ?? []) anchors.push(word.toLowerCase());
      regexSource += "([\\s\\S]+?)";
      cursor = match.index + match[0].length;
      match = PLACEHOLDER.exec(source);
    }

    const tail = source.slice(cursor);
    regexSource += `${escapeRegExp(tail)}$`;
    for (const word of tail.match(WORD) ?? []) anchors.push(word.toLowerCase());

    const pattern: Pattern = { regex: new RegExp(regexSource), template };
    for (const anchor of anchors) {
      const bucket = patternIndex.get(anchor);
      if (bucket) bucket.push(pattern);
      else patternIndex.set(anchor, [pattern]);
    }
  }
}

// Text nodes carry the indentation of the markup they came from, so lookups ignore the surrounding whitespace
const EDGES = /^(\s*)([\s\S]*?)(\s*)$/;

function matchPattern(core: string): string | undefined {
  const candidates = new Set<Pattern>();
  for (const word of core.match(WORD) ?? []) {
    const bucket = patternIndex.get(word.toLowerCase());
    if (!bucket) continue;
    for (const pattern of bucket) candidates.add(pattern);
  }

  for (const { regex, template } of candidates) {
    const match = regex.exec(core);
    if (!match) continue;
    return template.replace(INTERPOLATION, (_whole, index) => match[Number(index)] ?? "");
  }

  return undefined;
}

/** Translate a single source string, falling back to the source itself */
export function t(source: string): string {
  if (!source || locale === "en") return source;

  const dictionary = DICTIONARIES[locale];
  if (dictionary[source]) return dictionary[source];

  const [, lead, core, tail] = EDGES.exec(source) ?? [];
  if (!core) return source;

  if (dictionary[core]) return lead + dictionary[core] + tail;

  const collapsed = core.replace(/\s+/g, " ");
  if (collapsed !== core && dictionary[collapsed]) return lead + dictionary[collapsed] + tail;

  const pattern = matchPattern(core) ?? (collapsed === core ? undefined : matchPattern(collapsed));
  return pattern === undefined ? source : lead + pattern + tail;
}

/** Does the current dictionary know this string? */
export function hasTranslation(source: string): boolean {
  return t(source) !== source;
}

function applyTextNode(node: Text, source: string): void {
  const next = t(source);
  if ((node.nodeValue ?? "") === next) return;
  appliedText.set(node, next);
  node.nodeValue = next;
}

function applyAttribute(element: Element, name: string, source: string): void {
  const next = t(source);
  if ((element.getAttribute(name) ?? "") === next) return;

  let applied = appliedAttribute.get(element);
  if (!applied) {
    applied = new Map();
    appliedAttribute.set(element, applied);
  }
  applied.set(name, next);
  element.setAttribute(name, next);
}

function rememberAttribute(element: Element, name: string, source: string): void {
  let sources = attributeSource.get(element);
  if (!sources) {
    sources = new Map();
    attributeSource.set(element, sources);
  }
  sources.set(name, source);
}

/** Translate an element written by the app: its attributes may have just changed */
function translateElement(node: Element, refreshSource: boolean): void {
  if (optedOut(node)) return;

  for (const name of TRANSLATED_ATTRIBUTES) {
    const value = node.getAttribute(name);
    if (!value) continue;
    if (!refreshSource && value === appliedAttribute.get(node)?.get(name)) continue;
    rememberAttribute(node, name, value);
    applyAttribute(node, name, value);
  }
}

/** Translate the text of a node the app just wrote */
function translateText(node: Text): void {
  if (isSvgNode(node) || optedOut(node)) return;

  const value = node.nodeValue ?? "";
  if (value === appliedText.get(node)) return; // our own write, already translated
  textSource.set(node, value);
  applyTextNode(node, value);
}

/** Translate an element the app just inserted, together with everything below it */
function translateSubtree(node: Node): void {
  if (node.nodeType === Node.TEXT_NODE) {
    translateText(node as Text);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE || isSvgNode(node) || optedOut(node)) return;

  const root = node as Element;
  translateElement(root, true);

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      if (candidate.nodeType === Node.ELEMENT_NODE) {
        const element = candidate as Element;
        if (isSvgNode(element) || element.matches(OPT_OUT)) return NodeFilter.FILTER_REJECT;
        translateElement(element, true);
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) translateText(current as Text);
    current = walker.nextNode();
  }
}

/** Re-apply the current locale to everything already rendered, from the remembered sources */
function retranslateDocument(): void {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode(candidate) {
      if (candidate.nodeType === Node.ELEMENT_NODE) {
        const element = candidate as Element;
        if (isSvgNode(element) || element.matches(OPT_OUT)) return NodeFilter.FILTER_REJECT;
        for (const name of TRANSLATED_ATTRIBUTES) {
          const value = element.getAttribute(name);
          if (!value) continue;
          const source = attributeSource.get(element)?.get(name) ?? value;
          rememberAttribute(element, name, source);
          applyAttribute(element, name, source);
        }
        return NodeFilter.FILTER_SKIP;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let current = walker.nextNode();
  while (current) {
    if (current.nodeType === Node.TEXT_NODE) {
      const node = current as Text;
      const source = textSource.get(node) ?? node.nodeValue ?? "";
      textSource.set(node, source);
      applyTextNode(node, source);
    }
    current = walker.nextNode();
  }
}

const OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
  attributes: true,
  attributeFilter: TRANSLATED_ATTRIBUTES
};

// The map is deliberately never observed: it is redrawn constantly and holds world data, not copy
function observeContainer(element: Element): void {
  if (!observer || isSvgNode(element) || !element.isConnected) return;
  observer.observe(element, OBSERVER_OPTIONS);
}

function applyRecords(records: MutationRecord[]): void {
  for (const record of records) {
    if (record.type === "characterData") {
      translateText(record.target as Text);
      continue;
    }
    if (record.type === "attributes") {
      translateElement(record.target as Element, false);
      continue;
    }
    for (const node of record.addedNodes) translateSubtree(node);
  }
}

/** Watch the interface for content the app renders after boot */
function observeUi(): void {
  if (observer) return;

  observer = new MutationObserver(records => {
    applyRecords(records);
    // a panel the app just mounted at the top level needs to be followed from now on
    for (const record of records) {
      if (record.type !== "childList") continue;
      for (const node of record.addedNodes) if (node.nodeType === Node.ELEMENT_NODE) observeContainer(node as Element);
    }
  });

  observer.observe(document.body, { ...OBSERVER_OPTIONS, subtree: false });
  for (const child of document.body.children) observeContainer(child);
}

export function getLocale(): Locale {
  return locale;
}

function persistLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // private mode or storage disabled: the locale still applies for this session
  }
}

/** Switch the interface language and re-render every translated node */
export function setLocale(next: Locale): void {
  if (!DICTIONARIES[next] || next === locale) return;

  locale = next;
  if (typeof document !== "undefined") document.documentElement.lang = next;
  persistLocale(next);

  if (observer) retranslateDocument();
}

/** The ?lang= parameter wins, then the last choice, then Chinese as the default */
function resolveInitialLocale(): Locale {
  try {
    const requested = new URLSearchParams(location.search).get("lang") as Locale | null;
    if (requested && DICTIONARIES[requested]) return requested;
  } catch {
    // no location to read (tests, non-browser hosts)
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY) as Locale | null;
    if (stored && DICTIONARIES[stored]) return stored;
  } catch {
    // storage unavailable, fall through to the default
  }

  return "zh-CN";
}

/** Start localization: translate what is on screen and follow everything the app renders later */
export function initI18n(): void {
  const initial = resolveInitialLocale();
  if (initial !== locale) {
    locale = initial;
    persistLocale(initial);
  }
  document.documentElement.lang = locale;
  retranslateDocument();
  observeUi();
}

export const I18n = { t, hasTranslation, getLocale, setLocale, init: initI18n };

declare global {
  interface Window {
    I18n: typeof I18n;
  }
}

window.I18n = I18n;
