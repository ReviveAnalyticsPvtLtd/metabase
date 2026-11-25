import type { LocaleDataWithLanguage } from "metabase/utils/i18n";

/**
 * Power BI experience terminology pack.
 *
 * This is the "pseudo-locale" approach from the Power BI experience redesign:
 * instead of rewriting msgids across the app (which would change translations
 * and be irreversible), we register a synthetic English locale whose catalogue
 * contains only the approved terminology overrides. ttag falls back to the
 * source string for anything not in the catalogue, so the rest of the UI
 * renders unchanged.
 *
 * Entries are keyed by the exact msgid (`t\`...\`` source string). Only add
 * entries after review, and never edit the msgid source strings themselves.
 */
const PBI_TERMINOLOGY: Record<string, string> = {
  Bookmarks: "Favorites",
};

const PBI_GROUPED_TERMINOLOGY: Record<string, Record<string, string>> = {
  // MSGCTXT: ttag contextual translations (`c("context").t\`...\``)
  // Reserved for future worksheet entries.
};

type CatalogueEntry = { msgid: string; msgstr: string[] };

/**
 * Which real locale the Power BI terminology applies to. The overrides are
 * English text, so they are only correct for English sessions.
 */
export function supportsPowerBITerminology(language?: string): boolean {
  return language === undefined || language.toLowerCase().startsWith("en");
}

export function buildPowerBILocaleData(): LocaleDataWithLanguage {
  const translations: Record<string, Record<string, CatalogueEntry>> = {
    "": {},
  };

  for (const [msgid, msgstr] of Object.entries(PBI_TERMINOLOGY)) {
    translations[""][msgid] = { msgid, msgstr: [msgstr] };
  }

  for (const [msgctxt, entries] of Object.entries(PBI_GROUPED_TERMINOLOGY)) {
    translations[msgctxt] = {};
    for (const [msgid, msgstr] of Object.entries(entries)) {
      translations[msgctxt][msgid] = { msgid, msgstr: [msgstr] };
    }
  }

  return {
    headers: {
      language: "en-pbi",
      "plural-forms": "nplurals=2; plural=(n != 1);",
    },
    translations,
  };
}
