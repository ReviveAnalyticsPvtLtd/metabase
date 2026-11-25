import type { ClickObject } from "metabase/visualizations/types";
import type { ParameterId, ParameterValueOrArray } from "metabase-types/api";

import {
  getDashboardDrillParameters,
  getDashboardDrillType,
} from "./dashboard-click-drill";
import type { ParameterIdValuePair } from "./types";

export type ReportCrossFilter = {
  parameterId: ParameterIdValuePair[0];
  value: ParameterIdValuePair[1];
};

/**
 * Converts a visualization click into report-level filter updates.
 * Keeping this adapter separate lets report editors and dashboards share the
 * existing click-behavior mapping without duplicating date/value formatting.
 */
export function getReportCrossFilters(
  clicked: ClickObject | null | undefined,
): ReportCrossFilter[] {
  if (!clicked || getDashboardDrillType(clicked) !== "dashboard-filter") {
    return [];
  }

  return getDashboardDrillParameters(clicked).map(([parameterId, value]) => ({
    parameterId,
    value,
  }));
}

type ParameterValuesById = Record<
  ParameterId,
  ParameterValueOrArray | null | undefined
>;

function normalizeForComparison(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeForComparison);
  }
  return value ?? null;
}

/**
 * Whether the current report filter state already reflects this click.
 *
 * Cross-filter clicks toggle: applying a selection that is already active
 * clears it again. The UI uses this to render the selected state of the
 * clicked value, so the check has to compare exactly what
 * `setOrUnsetParameterValues` compares.
 */
export function isReportCrossFilterActive(
  filters: ReportCrossFilter[],
  parameterValues: ParameterValuesById,
): boolean {
  if (filters.length === 0) {
    return false;
  }

  return filters.every(({ parameterId, value }) => {
    const current = normalizeForComparison(parameterValues[parameterId]);
    const target = normalizeForComparison(value);

    if (Array.isArray(current) || Array.isArray(target)) {
      return (
        Array.isArray(current) &&
        Array.isArray(target) &&
        current.length === target.length &&
        current.every((item, index) => item === target[index])
      );
    }

    return current === target;
  });
}
