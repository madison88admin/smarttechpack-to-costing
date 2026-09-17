/** Narrows the marker rows the guard reports. */
export type MarkedRow = {
  id: string;
  request_number?: string;
  status: string;
  factory_name?: string;
  created_at?: string;
  notes?: string;
};

export type DriverRun = {
  /** This run's id: the driver writes it into every row it creates. */
  id: string;
  track(cleanup: () => Promise<unknown> | unknown): void;
  trackRequest(requestId?: string | null): void;
  /** Cleans up and reports whether rows were left behind. */
  finish(): Promise<{ blocked: boolean }>;
  leftovers(): Promise<MarkedRow[]>;
};

export function beginDriverRun(options: {
  name: string;
  marker: string;
  rest: string;
  headers: Record<string, string>;
}): Promise<DriverRun>;

export function exitCleanly(code?: number): Promise<never>;

/** The lock file guarding one database, so two runs cannot interleave. */
export function lockPathFor(rest: string, dir?: string): string;
