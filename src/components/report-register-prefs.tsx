"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  mergeRegisterPrefsIntoQuery,
  parseRegisterPrefs,
  serializeRegisterPrefs,
  type RegisterPrefs
} from "@/lib/reporting";

const STORAGE_KEY = "tp-costing:reports-register-prefs";

/**
 * Remembers the Request Register sort/dir/page across visits so a refresh does
 * not reset to defaults. The URL stays the source of truth:
 *  - When the URL has an explicit sort/dir/page, those win and are saved.
 *  - When it does not and a saved pref exists, we redirect to the restored URL
 *    once per page load (never fighting the user mid-session).
 */
export function ReportRegisterPrefs() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    const query = searchParams.toString();
    const params = new URLSearchParams(query);
    const hasSort = params.get("sort");
    const hasDir = params.get("dir");
    const hasPage = params.get("page");

    if (hasSort || hasDir || hasPage) {
      // Explicit URL state — persist it (defaults are omitted from URLs).
      const prefs: RegisterPrefs = {
        sort: (hasSort as RegisterPrefs["sort"]) || "created_at",
        dir: hasDir === "asc" ? "asc" : "desc",
        page: hasPage ? Math.max(1, Math.floor(Number(hasPage)) || 1) : 1
      };
      try {
        localStorage.setItem(STORAGE_KEY, serializeRegisterPrefs(prefs));
      } catch {
        // Storage unavailable (private mode) — persist nothing, degrade gracefully.
      }
      return;
    }

    // No explicit sort state in the URL — restore the saved one once.
    let saved: RegisterPrefs | null = null;
    try {
      saved = parseRegisterPrefs(localStorage.getItem(STORAGE_KEY));
    } catch {
      return;
    }
    if (!saved) return;
    const merged = mergeRegisterPrefsIntoQuery(query, saved);
    if (merged !== null) {
      router.replace(`${pathname}?${merged}`);
    }
  }, [router, pathname, searchParams]);

  return null;
}
