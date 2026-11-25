import { t } from "ttag";

import {
  applyPowerBITerminology,
  getPowerBITerminologyFlag,
  setPowerBITerminologyFlag,
} from "metabase/utils/i18n";
import {
  buildPowerBILocaleData,
  supportsPowerBITerminology,
} from "metabase/utils/i18n-terminology/pbi";

describe("Power BI terminology pack", () => {
  describe("supportsPowerBITerminology", () => {
    it("supports English locales", () => {
      expect(supportsPowerBITerminology("en")).toBe(true);
      expect(supportsPowerBITerminology("en-US")).toBe(true);
      expect(supportsPowerBITerminology(undefined)).toBe(true);
    });

    it("does not support non-English locales", () => {
      expect(supportsPowerBITerminology("fr")).toBe(false);
      expect(supportsPowerBITerminology("de-DE")).toBe(false);
    });
  });

  describe("buildPowerBILocaleData", () => {
    it("builds a valid ttag catalogue with msgids on every entry", () => {
      const localeData = buildPowerBILocaleData();

      expect(localeData.headers.language).toBe("en-pbi");

      const entries: Record<
        string,
        Record<string, { msgid: string; msgstr: string[] }>
      > = localeData.translations;

      for (const [msgctxt, catalogue] of Object.entries(entries)) {
        for (const [msgid, entry] of Object.entries(catalogue)) {
          expect(entry.msgid).toBe(msgid);
          expect(entry.msgstr.length).toBeGreaterThan(0);
          expect(msgctxt).toBeDefined();
        }
      }
    });

    it("maps Bookmarks to Favorites", () => {
      const localeData = buildPowerBILocaleData();

      expect(localeData.translations[""]["Bookmarks"].msgstr[0]).toBe(
        "Favorites",
      );
    });
  });

  describe("applyPowerBITerminology", () => {
    it("applies the pack and translates exposed msgids", () => {
      expect(applyPowerBITerminology(undefined)).toBe(true);
      expect(t`Bookmarks`).toBe("Favorites");
    });

    it("skips non-English locales", () => {
      const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
      try {
        expect(applyPowerBITerminology("fr")).toBe(false);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("fr"));
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("session flag", () => {
    it("round-trips the applied experience", () => {
      setPowerBITerminologyFlag("pbi");
      expect(getPowerBITerminologyFlag()).toBe("pbi");

      setPowerBITerminologyFlag("classic");
      expect(getPowerBITerminologyFlag()).toBe("classic");
    });
  });
});
