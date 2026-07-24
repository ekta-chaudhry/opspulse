import { EventEmitter } from "node:events";
import type { ClientRequest, IncomingMessage, RequestOptions } from "node:http";
import { describe, expect, it, vi } from "vitest";
import {
  SafeHttpRequestAbortedError,
  createSafeHttpClient,
} from "./safe-client.js";

class FakeRequest extends EventEmitter {
  readonly end = vi.fn();
  readonly destroy = vi.fn();
  readonly setTimeout = vi.fn();
}

class FakeResponse extends EventEmitter {
  statusCode = 204;
  readonly destroy = vi.fn();
}

const input = {
  url: "https://example.test:8443/health?full=true",
  method: "GET" as const,
  timeoutMs: 5000,
  headers: [{ name: "X-Probe", value: "opspulse" }],
};

describe("createSafeHttpClient", () => {
  it("rejects the target if any resolved address is prohibited", async () => {
    const transport = vi.fn();
    const client = createSafeHttpClient({
      lookup: () => Promise.resolve([
        { address: "192.0.2.1", family: 4 },
        { address: "127.0.0.1", family: 4 },
      ]),
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 0,
    });

    await expect(client(input)).resolves.toEqual({
      ok: false,
      category: "network",
      code: "ADDRESS_BLOCKED",
      latencyMs: 0,
    });
    expect(transport).not.toHaveBeenCalled();
  });

  it("pins a validated address while preserving Host and TLS SNI", async () => {
    let options: RequestOptions | undefined;
    const response = new FakeResponse();
    const request = new FakeRequest();
    const transport = vi.fn(
      (requestOptions: RequestOptions, onResponse: (value: IncomingMessage) => void) => {
        options = requestOptions;
        queueMicrotask(() => {
          onResponse(response as unknown as IncomingMessage);
        });
        return request as unknown as ClientRequest;
      },
    );
    const client = createSafeHttpClient({
      lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      httpRequest: transport,
      httpsRequest: transport,
      now: (() => {
        let current = 100;
        return () => (current += 12);
      })(),
    });

    await expect(client(input)).resolves.toEqual({ ok: true, status: 204, latencyMs: 12 });
    expect(options).toMatchObject({
      hostname: "example.test",
      port: 8443,
      path: "/health?full=true",
      method: "GET",
      servername: "example.test",
      headers: { Host: "example.test:8443", "X-Probe": "opspulse" },
    });
    expect(options?.lookup).toBeTypeOf("function");
    const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options?.lookup?.("example.test", {}, (error, address, family) => {
        if (error !== null) reject(error);
        else if (typeof address !== "string") reject(new Error("expected one pinned address"));
        else if (family === undefined) reject(new Error("expected pinned address family"));
        else resolve({ address, family });
      });
    });
    expect(pinned).toEqual({ address: "93.184.216.34", family: 4 });
    const pinnedAll = await new Promise<readonly { address: string; family: number }[]>(
      (resolve, reject) => {
        options?.lookup?.("example.test", { all: true }, (error, addresses) => {
          if (error !== null) reject(error);
          else if (!Array.isArray(addresses)) reject(new Error("expected pinned addresses"));
          else resolve(addresses);
        });
      },
    );
    expect(pinnedAll).toEqual([{ address: "93.184.216.34", family: 4 }]);
    expect(request.end).toHaveBeenCalledOnce();
    expect(response.destroy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      url: "http://[::ffff:8.8.8.8]/",
      hostname: "::ffff:808:808",
      host: "[::ffff:808:808]",
      address: "::ffff:8.8.8.8",
      port: undefined,
    },
    {
      url: "https://[2606:4700:4700::1111]:8443/",
      hostname: "2606:4700:4700::1111",
      host: "[2606:4700:4700::1111]:8443",
      address: "2606:4700:4700::1111",
      port: 8443,
    },
  ])("supports allowed IPv6 literal target $url", async ({
    url,
    hostname,
    host,
    address,
    port,
  }) => {
    let options: RequestOptions | undefined;
    const lookup = vi.fn(() => Promise.resolve([{ address, family: 6 as const }]));
    const response = new FakeResponse();
    const request = new FakeRequest();
    const transport = vi.fn(
      (requestOptions: RequestOptions, onResponse: (value: IncomingMessage) => void) => {
        options = requestOptions;
        queueMicrotask(() => {
          onResponse(response as unknown as IncomingMessage);
        });
        return request as unknown as ClientRequest;
      },
    );
    const client = createSafeHttpClient({
      lookup,
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 0,
    });

    await expect(client({ ...input, url })).resolves.toEqual({
      ok: true,
      status: 204,
      latencyMs: 0,
    });

    expect(lookup).toHaveBeenCalledWith(hostname);
    expect(options).toMatchObject({
      hostname,
      path: "/",
      headers: { Host: host, "X-Probe": "opspulse" },
      ...(port === undefined ? {} : { port }),
    });
    expect(options).not.toHaveProperty("servername");
    const pinned = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      options?.lookup?.(hostname, {}, (error, pinnedAddress, family) => {
        if (error !== null) reject(error);
        else if (typeof pinnedAddress !== "string") reject(new Error("expected pinned address"));
        else if (family === undefined) reject(new Error("expected pinned family"));
        else resolve({ address: pinnedAddress, family });
      });
    });
    expect(pinned).toEqual({ address, family: 6 });
  });

  it("classifies a prohibited IPv6 literal as blocked without a DNS failure", async () => {
    const lookup = vi.fn(() =>
      Promise.resolve([{ address: "::ffff:127.0.0.1", family: 6 as const }]),
    );
    const transport = vi.fn();
    const client = createSafeHttpClient({
      lookup,
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 0,
    });

    await expect(client({ ...input, url: "http://[::ffff:127.0.0.1]/" })).resolves.toEqual({
      ok: false,
      category: "network",
      code: "ADDRESS_BLOCKED",
      latencyMs: 0,
    });
    expect(lookup).toHaveBeenCalledWith("::ffff:7f00:1");
    expect(transport).not.toHaveBeenCalled();
  });

  it("returns a classified failure without exposing transport errors", async () => {
    const request = new FakeRequest();
    const transport = vi.fn(() => {
      queueMicrotask(() => {
        const error = Object.assign(new Error("secret certificate detail"), {
          code: "CERT_HAS_EXPIRED",
        });
        request.emit("error", error);
      });
      return request as unknown as ClientRequest;
    });
    const client = createSafeHttpClient({
      lookup: () => Promise.resolve([{ address: "2606:4700:4700::1111", family: 6 }]),
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 10,
    });

    const result = await client(input);
    expect(result).toEqual({
      ok: false,
      category: "tls",
      code: "CERT_HAS_EXPIRED",
      latencyMs: 0,
    });
    expect(JSON.stringify(result)).not.toContain("secret certificate detail");
  });

  it("applies the deadline to DNS resolution without starting a late request", async () => {
    vi.useFakeTimers();
    let resolveLookup: ((addresses: { address: string; family: 4 }[]) => void) | undefined;
    const lookup = vi.fn(
      () =>
        new Promise<{ address: string; family: 4 }[]>((resolve) => {
          resolveLookup = resolve;
        }),
    );
    const transport = vi.fn();
    const client = createSafeHttpClient({
      lookup,
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 100,
    });

    try {
      const result = client(input);
      await vi.advanceTimersByTimeAsync(input.timeoutMs);
      await expect(result).resolves.toEqual({
        ok: false,
        category: "timeout",
        code: "ETIMEDOUT",
        latencyMs: 0,
      });

      resolveLookup?.([{ address: "93.184.216.34", family: 4 }]);
      await Promise.resolve();
      expect(transport).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("shares one deadline between DNS and the HTTP request", async () => {
    vi.useFakeTimers();
    const request = new FakeRequest();
    const transport = vi.fn(() => request as unknown as ClientRequest);
    const client = createSafeHttpClient({
      lookup: () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve([{ address: "93.184.216.34", family: 4 }]);
          }, 4000);
        }),
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 100,
    });

    try {
      const result = client(input);
      await vi.advanceTimersByTimeAsync(4000);
      expect(request.setTimeout).toHaveBeenCalledWith(1000, expect.any(Function));
      await vi.advanceTimersByTimeAsync(1000);
      await expect(result).resolves.toEqual({
        ok: false,
        category: "timeout",
        code: "ETIMEDOUT",
        latencyMs: 0,
      });
      expect(request.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborts DNS resolution without starting a request", async () => {
    const controller = new AbortController();
    const transport = vi.fn();
    const client = createSafeHttpClient({
      lookup: () => new Promise(() => undefined),
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 0,
    });

    const result = client({ ...input, signal: controller.signal });
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(SafeHttpRequestAbortedError);
    expect(transport).not.toHaveBeenCalled();
  });

  it("destroys an in-flight socket when aborted", async () => {
    const controller = new AbortController();
    const request = new FakeRequest();
    const transport = vi.fn(() => request as unknown as ClientRequest);
    const client = createSafeHttpClient({
      lookup: () => Promise.resolve([{ address: "93.184.216.34", family: 4 }]),
      httpRequest: transport,
      httpsRequest: transport,
      now: () => 0,
    });

    const result = client({ ...input, signal: controller.signal });
    await vi.waitFor(() => {
      expect(request.end).toHaveBeenCalledOnce();
    });
    controller.abort();

    await expect(result).rejects.toBeInstanceOf(SafeHttpRequestAbortedError);
    expect(request.destroy).toHaveBeenCalledOnce();
  });
});
