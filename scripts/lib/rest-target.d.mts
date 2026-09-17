export const DEFAULT_REST: string;
export const LIVE_OPT_IN_ENV: string;

export class UnsafeDriverTargetError extends Error {}

export function resolveRestTarget(options?: {
  env?: Record<string, string | undefined>;
  usage?: string;
}): { rest: string; live: boolean };
