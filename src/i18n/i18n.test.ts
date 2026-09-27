// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { zhCN } from "@/i18n/locales/zh-CN";
import { initI18n, setLocale, t } from "./index";

const PLACEHOLDER = /\$\{[^}]*\}/g;
// File formats, brand names and the one acronym that stays as it is
const NOT_TRANSLATED = new Set([
  "woff2",
  ".svg",
  ".png",
  ".jpeg",
  ".map",
  "URL",
  "Azgaar's",
  "Azgaar's Fantasy Map Generator",
  "Fantasy Map Generator",
  "Google Fonts",
  "Fontdesk",
  "DaFont",
  "CDN Fonts"
]);

/** Text nodes and translated attributes of the static shell, as the browser will see them */
function shellStrings(): string[] {
  const html = readFileSync("src/index.html", "utf8");
  const body = html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  const found = new Set<string>();

  const text = />([^<>]+)</g;
  let match = text.exec(body);
  while (match) {
    const value = match[1].replace(/\s+/g, " ").trim();
    if (value && /[A-Za-z]{2}/.test(value) && value.length <= 240) found.add(value);
    match = text.exec(body);
  }

  for (const name of ["title", "placeholder", "aria-label", "alt", "data-tip", "data-main"]) {
    const attribute = new RegExp(`${name}="([^"]*)"`, "g");
    match = attribute.exec(html);
    while (match) {
      const value = match[1].replace(/\s+/g, " ").trim();
      if (value && /[A-Za-z]{2}/.test(value) && value.length <= 300) found.add(value);
      match = attribute.exec(html);
    }
  }

  return [...found];
}

function render(html: string): void {
  document.body.innerHTML = html;
  initI18n();
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.lang = "";
  document.body.replaceChildren();
  setLocale("zh-CN");
});

describe("dictionary", () => {
  it("never maps a string to itself or to nothing", () => {
    for (const [source, translation] of Object.entries(zhCN)) {
      expect(source.trim(), "empty key").not.toBe("");
      expect(translation.trim(), `no translation for ${source}`).not.toBe("");
      expect(translation, `${source} is not translated`).not.toBe(source);
    }
  });

  it("keeps every placeholder of the source, in the same order", () => {
    for (const [source, translation] of Object.entries(zhCN)) {
      expect(translation.match(PLACEHOLDER) ?? [], `placeholders of ${source}`).toEqual(
        source.match(PLACEHOLDER) ?? []
      );
    }
  });

  it("covers the whole static interface", () => {
    const missing = shellStrings().filter(value => !NOT_TRANSLATED.has(value) && !zhCN[value]);
    expect(missing).toEqual([]);
  });
});

describe("t", () => {
  it("translates known strings and returns unknown ones untouched", () => {
    expect(t("Save")).toBe("保存");
    expect(t("Click to show the Menu")).toBe("点击显示菜单");
    expect(t("Wagga Wagga")).toBe("Wagga Wagga");
  });

  it("translates templates around their placeholders", () => {
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the placeholders belong to the source string
    expect(t("${subjectName} became a vassal of ${objectName}")).toBe("${subjectName} 成为 ${objectName} 的附庸");
    expect(t("Novigrad is saved")).toBe("Novigrad 已保存");
  });

  it("returns the source while English is selected", () => {
    setLocale("en");
    expect(t("Save")).toBe("Save");
  });
});

describe("translate=\"no\"", () => {
  it("leaves opted-out content alone, including the language picker itself", () => {
    render(
      `<select translate="no"><option>English</option></select><button data-tip="Save">Save</button>`
    );

    expect(document.querySelector("option")?.textContent).toBe("English");
    expect(document.querySelector("button")?.textContent).toBe("保存");
  });
});

describe("rendered interface", () => {
  it("translates text nodes, attributes and text wrapped over several lines", () => {
    render(`
      <div id="sticked"><button data-tip="Save fully-functional map file">Save</button></div>
      <input id="search" placeholder="Search map and commands" />
      <p id="wrapped">Search map and
        commands</p>
      <svg id="map"><text id="mapLabel">Save</text></svg>
    `);

    expect(document.querySelector("#sticked button")?.textContent).toBe("保存");
    expect(document.querySelector("#sticked button")?.getAttribute("data-tip")).toBe("保存功能完整的地图文件");
    expect(document.querySelector("#search")?.getAttribute("placeholder")).toBe("搜索地图和命令");
    expect(document.querySelector("#wrapped")?.textContent?.trim()).toBe("搜索地图和命令");
  });

  it("leaves the map itself alone, it is world data and not interface copy", () => {
    render('<svg id="map"><text id="mapLabel">Save</text><title>Layers</title></svg>');
    expect(document.querySelector("#mapLabel")?.textContent).toBe("Save");
    expect(document.querySelector("#map title")?.textContent).toBe("Layers");
  });

  it("translates what the app renders after boot", async () => {
    render('<div id="dialogs"></div>');

    const button = document.createElement("button");
    button.textContent = "Save";
    button.setAttribute("data-tip", "Save fully-functional map file");
    document.querySelector("#dialogs")!.append(button);

    await new Promise(resolve => setTimeout(resolve, 0));
    expect(button.textContent).toBe("保存");
    expect(button.getAttribute("data-tip")).toBe("保存功能完整的地图文件");
  });

  it("goes back to English and forward again without losing the source text", () => {
    render('<button id="save">Save</button>');
    const button = document.querySelector("#save")!;
    expect(button.textContent).toBe("保存");

    setLocale("en");
    expect(button.textContent).toBe("Save");

    setLocale("zh-CN");
    expect(button.textContent).toBe("保存");
  });
});
