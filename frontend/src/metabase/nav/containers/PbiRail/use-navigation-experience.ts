import { useSetting } from "metabase/settings";
import type { NavigationExperience } from "metabase-types/api";

/**
 * The product has one unified navigation experience.
 *
 * The legacy setting is intentionally still read so older sessions and
 * serialized user preferences remain compatible during rollout, but it no
 * longer controls the product surface. Embeds and SDK surfaces retain their
 * own explicit compatibility guards at their call sites.
 */
export function useNavigationExperience(): NavigationExperience {
  useSetting("navigation-experience");
  return "pbi";
}
