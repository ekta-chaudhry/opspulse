import {
  HttpMethodSchema,
  OutboundHttpUrlSchema,
  RequestHeaderSchema,
  type HttpMethod,
  type RequestHeader,
} from "@opspulse/contracts";
import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import {
  request as nodeHttpRequest,
  type ClientRequest,
  type IncomingMessage,
  type RequestOptions,
} from "node:http";
import { request as nodeHttpsRequest } from "node:https";
import { isAllowedAddress } from "./address-policy.js";

export type SafeHttpRequest = {
  url: string;
  method: HttpMethod;
  timeoutMs: number;
  headers: RequestHeader[];
  signal?: AbortSignal;
};

export class SafeHttpRequestAbortedError extends Error {
  constructor() {
    super("HTTP check was aborted");
    this.name = "SafeHttpRequestAbortedError";
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new SafeHttpRequestAbortedError();
}

export type SafeFailureCategory =
  | "timeout"
  | "dns"
  | "connection"
  | "tls"
  | "network"
  | "unknown";

export type SafeHttpResult =
  | { ok: true; status: number; latencyMs: number }
  | {
      ok: false;
      category: SafeFailureCategory;
      code: string | null;
      latencyMs: number | null;
    };

type RequestTransport = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ClientRequest;

const DNS_TIMEOUT = new Error("DNS lookup timed out");

export type SafeHttpClientDependencies = {
  lookup: (hostname: string) => Promise<readonly LookupAddress[]>;
  httpRequest: RequestTransport;
  httpsRequest: RequestTransport;
  now: () => number;
};

const defaults: SafeHttpClientDependencies = {
  lookup: async (hostname) => dnsLookup(hostname, { all: true, verbatim: true }),
  httpRequest: (options, onResponse) => nodeHttpRequest(options, onResponse),
  httpsRequest: (options, onResponse) => nodeHttpsRequest(options, onResponse),
  now: () => Date.now(),
};

function safeCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[A-Z0-9_-]{1,64}$/.test(code) ? code : null;
}

function categoryFor(code: string | null): SafeFailureCategory {
  if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "timeout";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "EAI_FAIL") return "dns";
  if (
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EPIPE" ||
    code === "EHOSTUNREACH"
  ) {
    return "connection";
  }
  if (
    code?.startsWith("CERT_") === true ||
    code?.startsWith("ERR_TLS_") === true ||
    code?.startsWith("DEPTH_") === true ||
    code?.startsWith("UNABLE_TO_") === true
  ) {
    return "tls";
  }
  if (code?.startsWith("ENET") === true || code === "EHOSTDOWN") return "network";
  return "unknown";
}

function elapsed(now: () => number, startedAt: number): number {
  return Math.max(0, Math.round(now() - startedAt));
}

export function createSafeHttpClient(
  dependencies: SafeHttpClientDependencies = defaults,
): (input: SafeHttpRequest) => Promise<SafeHttpResult> {
  return async (input) => {
    const startedAt = dependencies.now();
    throwIfAborted(input.signal);
    let url: URL;
    try {
      url = new URL(OutboundHttpUrlSchema.parse(input.url));
      HttpMethodSchema.parse(input.method);
      input.headers.forEach((header) => RequestHeaderSchema.parse(header));
      if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 30_000) {
        throw new TypeError("invalid timeout");
      }
    } catch {
      return {
        ok: false,
        category: "unknown",
        code: "INVALID_REQUEST",
        latencyMs: elapsed(dependencies.now, startedAt),
      };
    }
    const deadlineAt = Date.now() + input.timeoutMs;

    let addresses: readonly LookupAddress[];
    let timeoutHandle: NodeJS.Timeout | undefined;
    let abortHandler: (() => void) | undefined;
    try {
      const dnsTimeout = new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(DNS_TIMEOUT);
        }, Math.max(1, deadlineAt - Date.now()));
      });
      const aborted = new Promise<never>((_resolve, reject) => {
        if (input.signal === undefined) return;
        abortHandler = () => {
          reject(new SafeHttpRequestAbortedError());
        };
        input.signal.addEventListener("abort", abortHandler, { once: true });
      });
      addresses = await Promise.race([
        dependencies.lookup(url.hostname),
        dnsTimeout,
        aborted,
      ]);
    } catch (error) {
      if (error instanceof SafeHttpRequestAbortedError) throw error;
      if (error === DNS_TIMEOUT) {
        return {
          ok: false,
          category: "timeout",
          code: "ETIMEDOUT",
          latencyMs: elapsed(dependencies.now, startedAt),
        };
      }
      return {
        ok: false,
        category: "dns",
        code: safeCode(error),
        latencyMs: elapsed(dependencies.now, startedAt),
      };
    } finally {
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
      if (abortHandler !== undefined) {
        input.signal?.removeEventListener("abort", abortHandler);
      }
    }
    if (
      addresses.length === 0 ||
      addresses.some(
        ({ address, family }) =>
          (family !== 4 && family !== 6) || !isAllowedAddress(address),
      )
    ) {
      return {
        ok: false,
        category: "network",
        code: "ADDRESS_BLOCKED",
        latencyMs: elapsed(dependencies.now, startedAt),
      };
    }

    const selected = addresses[0];
    if (selected === undefined) {
      return { ok: false, category: "dns", code: "NO_ADDRESSES", latencyMs: null };
    }
    const headers: Record<string, string> = { Host: url.host };
    for (const header of input.headers) headers[header.name] = header.value;
    const transport = url.protocol === "https:" ? dependencies.httpsRequest : dependencies.httpRequest;
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return {
        ok: false,
        category: "timeout",
        code: "ETIMEDOUT",
        latencyMs: elapsed(dependencies.now, startedAt),
      };
    }

    throwIfAborted(input.signal);
    return new Promise<SafeHttpResult>((resolve, reject) => {
      let settled = false;
      const deadline = { timer: undefined as NodeJS.Timeout | undefined };
      const cleanup = (): void => {
        if (deadline.timer !== undefined) clearTimeout(deadline.timer);
        input.signal?.removeEventListener("abort", onAbort);
      };
      const finish = (result: SafeHttpResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(result);
      };
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        request.destroy();
        reject(new SafeHttpRequestAbortedError());
      };
      const options: RequestOptions = {
        protocol: url.protocol,
        hostname: url.hostname,
        ...(url.port === "" ? {} : { port: Number(url.port) }),
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers,
        agent: false,
        lookup: (_hostname, options, callback) => {
          if (options.all === true) {
            callback(null, [selected]);
          } else {
            callback(null, selected.address, selected.family);
          }
        },
        ...(url.protocol === "https:" ? { servername: url.hostname } : {}),
      };
      const request = transport(options, (response) => {
        const status = response.statusCode;
        if (status === undefined || status < 100 || status > 599) {
          finish({
            ok: false,
            category: "network",
            code: "INVALID_HTTP_STATUS",
            latencyMs: elapsed(dependencies.now, startedAt),
          });
        } else {
          finish({ ok: true, status, latencyMs: elapsed(dependencies.now, startedAt) });
        }
        response.destroy();
      });
      const onTimeout = (): void => {
        finish({
          ok: false,
          category: "timeout",
          code: "ETIMEDOUT",
          latencyMs: elapsed(dependencies.now, startedAt),
        });
        request.destroy();
      };
      deadline.timer = setTimeout(onTimeout, remainingMs);
      request.setTimeout(remainingMs, onTimeout);
      request.once("error", (error: unknown) => {
        const code = safeCode(error);
        finish({
          ok: false,
          category: categoryFor(code),
          code,
          latencyMs: elapsed(dependencies.now, startedAt),
        });
      });
      input.signal?.addEventListener("abort", onAbort, { once: true });
      if (input.signal?.aborted === true) {
        onAbort();
        return;
      }
      request.end();
    });
  };
}

export const executeSafeHttp = createSafeHttpClient();
