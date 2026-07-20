/** Shared contracts for composable application HTTP clients. */

/** Per-request policy overrides supported by the shared HTTP boundary. */
export interface FetchOpts {
  timeoutMs?: number;
  headers?: Readonly<Record<string, string>>;
}

/** Text response details required by callers and HTTP decorators. */
export interface FetchResult {
  finalUrl: string;
  status: number;
  body: string;
  contentType: string | null;
  headers?: Readonly<Record<string, string>>;
  fromCache?: boolean;
}

/** Text-oriented network capability shared by detection and adapters. */
export interface HttpClient {
  fetchText(url: string, options?: FetchOpts): Promise<FetchResult>;
  postJson(url: string, body: unknown, options?: FetchOpts): Promise<FetchResult>;
}
