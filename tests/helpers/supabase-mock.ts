// Chainable Supabase test double shared by the integration tests.
// Reproduces the PostgREST builder API (.from().select().eq().is().limit().
// order(), terminal .single()/.maybeSingle()/.insert()/.delete()/.update())
// and routes every terminal call through a per-table responder, recording all
// calls so tests can assert on exact payloads. Fails loudly on unconfigured
// .single()/.maybeSingle() queries so tests cannot silently drift from the
// real code's query pattern.

export type Chain = {
  select?: unknown;
  eq?: [string, unknown][];
  is?: [string, unknown][];
  not?: [string, string, unknown][];
  in?: [string, unknown[]][];
  ilike?: [string, unknown][];
  gte?: [string, unknown][];
  lte?: [string, unknown][];
  gt?: [string, unknown][];
  lt?: [string, unknown][];
  limit?: number;
  range?: [number, number];
  or?: string[];
  order?: [string, unknown][];
  payload?: unknown;
};

export type QueryResult = { data: unknown; error: unknown };
export type Handler = (chain: Chain) => QueryResult;
export type TableHandlers = Partial<Record<string, Handler>>;
export type Responder = Record<string, TableHandlers>;

export type Call = { table: string; terminal: string; chain: Chain };

class FakeBuilder {
  private chain: Chain = {};
  private terminal: string | null = null;

  constructor(
    private table: string,
    private responder: Responder,
    private calls: Call[]
  ) {}

  select(cols?: unknown) {
    this.chain.select = cols;
    this.terminal = "select";
    return this;
  }

  eq(col: string, val: unknown) {
    (this.chain.eq ??= []).push([col, val]);
    return this;
  }

  is(col: string, val: unknown) {
    (this.chain.is ??= []).push([col, val]);
    return this;
  }

  ilike(col: string, val: unknown) {
    (this.chain.ilike ??= []).push([col, val]);
    return this;
  }

  not(col: string, operator: string, val: unknown) {
    (this.chain.not ??= []).push([col, operator, val]);
    return this;
  }

  in(col: string, vals: unknown[]) {
    (this.chain.in ??= []).push([col, vals]);
    return this;
  }

  gte(col: string, val: unknown) {
    (this.chain.gte ??= []).push([col, val]);
    return this;
  }

  lte(col: string, val: unknown) {
    (this.chain.lte ??= []).push([col, val]);
    return this;
  }

  gt(col: string, val: unknown) {
    (this.chain.gt ??= []).push([col, val]);
    return this;
  }

  lt(col: string, val: unknown) {
    (this.chain.lt ??= []).push([col, val]);
    return this;
  }

  limit(n: number) {
    this.chain.limit = n;
    return this;
  }

  range(start: number, end: number) {
    this.chain.range = [start, end];
    return this;
  }

  or(filter: string) {
    (this.chain.or ??= []).push(filter);
    return this;
  }

  order(col: string, opts?: unknown) {
    (this.chain.order ??= []).push([col, opts]);
    return this;
  }

  update(payload: unknown) {
    this.chain.payload = payload;
    return this;
  }

  insert(payload: unknown) {
    // Chainable: callers may continue with .select().single() or await directly.
    this.chain.payload = payload;
    this.terminal = "insert";
    return this;
  }

  upsert(payload: unknown, _opts?: unknown) {
    // Chainable like insert(): callers continue with .select().single().
    this.chain.payload = payload;
    return this;
  }

  delete() {
    // Chainable like update(): callers may .eq() before awaiting.
    this.terminal = "delete";
    return this;
  }

  single() {
    return this.terminalCall("single");
  }

  maybeSingle() {
    return this.terminalCall("maybeSingle");
  }

  then(onFulfilled?: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) {
    return Promise.resolve(this.respond()).then(onFulfilled, onRejected);
  }

  private terminalCall(terminal: string) {
    this.terminal = terminal;
    return {
      then: (onFulfilled?: (v: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve(this.respond()).then(onFulfilled, onRejected)
    };
  }

  private respond(): QueryResult {
    const terminal = this.terminal ?? "select";
    const snapshot: Chain = {
      ...this.chain,
      eq: this.chain.eq?.slice(),
      is: this.chain.is?.slice(),
      not: this.chain.not?.slice(),
      in: this.chain.in?.slice(),
      ilike: this.chain.ilike?.slice(),
      gte: this.chain.gte?.slice(),
      lte: this.chain.lte?.slice(),
      gt: this.chain.gt?.slice(),
      lt: this.chain.lt?.slice(),
      order: this.chain.order?.slice()
    };
    this.calls.push({ table: this.table, terminal, chain: snapshot });
    const handler = this.responder[this.table]?.[terminal];
    if (handler) return handler(snapshot);
    if (terminal === "single" || terminal === "maybeSingle") {
      throw new Error(`Unhandled query: ${this.table}.${terminal}`);
    }
    return { data: [], error: null };
  }
}

export function createMockSupabase(responder: Responder = {}) {
  const calls: Call[] = [];
  const client = { from: (table: string) => new FakeBuilder(table, responder, calls) };
  return { client, calls };
}

export function inserts(calls: Call[], table: string) {
  return calls.filter((c) => c.table === table && c.terminal === "insert").map((c) => c.chain.payload);
}

export function updates(calls: Call[], table: string) {
  return calls.filter((c) => c.table === table && c.terminal === "select" && c.chain.payload).map((c) => c.chain.payload);
}
