// Azgaar and contributors, 2017-2026. MIT License
// https://github.com/Azgaar/Fantasy-Map-Generator

import "@/services/logging";
import "@/components/globals";
import "@/components/options/tabs";

import "@/utils";
import "@/data/supporters";
import "@/data/heightmap-templates";
import "@/data/precreated-heightmaps";
import "@/generators";
import "@/renderers";
import "@/components";
import "@/controllers";
import "@/services";
import "@/generators/styles-legacy";

import { boot } from "@/components/lifecycle";
import { initI18n } from "@/i18n";

document.addEventListener("DOMContentLoaded", () => {
  initI18n();
  boot();
});
