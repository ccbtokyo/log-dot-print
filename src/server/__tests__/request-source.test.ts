import { describe, test, expect } from "bun:test";
import { resolveRequestSource } from "../request-source";
import type { IncomingHttpHeaders } from "http";

describe("resolveRequestSource", () => {
  describe("x-forwarded-for", () => {
    test("returns single IP", () => {
      const headers = new Headers({ "x-forwarded-for": "192.168.1.1" });
      expect(resolveRequestSource(headers)).toBe("192.168.1.1");
    });

    test("returns first IP from comma-separated list", () => {
      const headers = new Headers({ "x-forwarded-for": "10.0.0.1, 10.0.0.2, 10.0.0.3" });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });
  });

  describe("forwarded", () => {
    test("parses for= syntax", () => {
      const headers = new Headers({ forwarded: "for=192.168.1.1" });
      expect(resolveRequestSource(headers)).toBe("192.168.1.1");
    });

    test("parses quoted IP", () => {
      const headers = new Headers({ forwarded: 'for="192.168.1.1"' });
      expect(resolveRequestSource(headers)).toBe("192.168.1.1");
    });

    test("parses IPv6 in brackets", () => {
      const headers = new Headers({ forwarded: 'for="[::1]"' });
      expect(resolveRequestSource(headers)).toBe("::1");
    });

    test("returns first for= from multiple directives", () => {
      const headers = new Headers({ forwarded: "for=10.0.0.1, for=10.0.0.2" });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });
  });

  describe("other headers", () => {
    test("x-real-ip", () => {
      const headers = new Headers({ "x-real-ip": "172.16.0.1" });
      expect(resolveRequestSource(headers)).toBe("172.16.0.1");
    });

    test("cf-connecting-ip", () => {
      const headers = new Headers({ "cf-connecting-ip": "203.0.113.1" });
      expect(resolveRequestSource(headers)).toBe("203.0.113.1");
    });

    test("true-client-ip", () => {
      const headers = new Headers({ "true-client-ip": "198.51.100.1" });
      expect(resolveRequestSource(headers)).toBe("198.51.100.1");
    });

    test("x-client-ip", () => {
      const headers = new Headers({ "x-client-ip": "10.10.10.1" });
      expect(resolveRequestSource(headers)).toBe("10.10.10.1");
    });

    test("x-log-dot-print-remote-address", () => {
      const headers = new Headers({ "x-log-dot-print-remote-address": "10.20.30.40" });
      expect(resolveRequestSource(headers)).toBe("10.20.30.40");
    });
  });

  describe("fallback chain", () => {
    test("falls back to remoteAddress", () => {
      const headers = new Headers();
      expect(resolveRequestSource(headers, "127.0.0.1")).toBe("127.0.0.1");
    });

    test("falls back to from header", () => {
      const headers = new Headers({ from: "user@example.com" });
      expect(resolveRequestSource(headers)).toBe("user@example.com");
    });

    test("falls back to host header", () => {
      const headers = new Headers({ host: "example.com:3000" });
      expect(resolveRequestSource(headers)).toBe("example.com:3000");
    });

    test("returns unknown when no source found", () => {
      const headers = new Headers();
      expect(resolveRequestSource(headers)).toBe("unknown");
    });
  });

  describe("priority order", () => {
    test("x-forwarded-for takes priority over x-real-ip", () => {
      const headers = new Headers({
        "x-forwarded-for": "10.0.0.1",
        "x-real-ip": "10.0.0.2",
      });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });

    test("forwarded takes priority over x-real-ip", () => {
      const headers = new Headers({
        forwarded: "for=10.0.0.1",
        "x-real-ip": "10.0.0.2",
      });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });

    test("x-real-ip takes priority over remoteAddress", () => {
      const headers = new Headers({ "x-real-ip": "10.0.0.1" });
      expect(resolveRequestSource(headers, "127.0.0.1")).toBe("10.0.0.1");
    });

    test("remoteAddress takes priority over from", () => {
      const headers = new Headers({ from: "user@example.com" });
      expect(resolveRequestSource(headers, "127.0.0.1")).toBe("127.0.0.1");
    });
  });

  describe("IncomingHttpHeaders (Node.js format)", () => {
    test("reads lowercase header keys", () => {
      const headers: IncomingHttpHeaders = {
        "x-forwarded-for": "192.168.1.1",
      };
      expect(resolveRequestSource(headers)).toBe("192.168.1.1");
    });

    test("handles array values (uses first element)", () => {
      const headers: IncomingHttpHeaders = {
        "x-real-ip": ["10.0.0.1", "10.0.0.2"] as unknown as string,
      };
      // IncomingHttpHeaders allows string | string[] | undefined
      // The implementation handles arrays by returning the first element
      expect(resolveRequestSource(headers as IncomingHttpHeaders)).toBe("10.0.0.1");
    });
  });

  describe("whitespace handling", () => {
    test("trims whitespace from IP headers", () => {
      const headers = new Headers({ "x-real-ip": "  10.0.0.1  " });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });

    test("trims whitespace from x-forwarded-for", () => {
      const headers = new Headers({ "x-forwarded-for": "  10.0.0.1 , 10.0.0.2" });
      expect(resolveRequestSource(headers)).toBe("10.0.0.1");
    });
  });
});
