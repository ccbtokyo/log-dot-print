import type { IncomingHttpHeaders } from "http";

type HeaderSource = Headers | IncomingHttpHeaders;

const getHeader = (headers: HeaderSource, name: string): string | undefined => {
  if (headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const normalizeForwardedFor = (value: string): string => {
  let trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    trimmed = trimmed.slice(1, -1);
  }
  if (trimmed.startsWith("[") && trimmed.includes("]")) {
    trimmed = trimmed.slice(1, trimmed.indexOf("]"));
  }
  return trimmed;
};

const parseForwardedHeader = (value: string): string | undefined => {
  const parts = value.split(",");
  for (const part of parts) {
    const match = part.match(/for=([^;]+)/i);
    if (match) {
      return normalizeForwardedFor(match[1] ?? "");
    }
  }
  return undefined;
};

export const resolveRequestSource = (headers: HeaderSource, remoteAddress?: string): string => {
  const forwardedFor = getHeader(headers, "x-forwarded-for");
  if (forwardedFor) {
    return normalizeForwardedFor(forwardedFor.split(",")[0] ?? forwardedFor);
  }

  const forwarded = getHeader(headers, "forwarded");
  if (forwarded) {
    const parsed = parseForwardedHeader(forwarded);
    if (parsed) {
      return parsed;
    }
  }

  const realIp =
    getHeader(headers, "x-real-ip") ||
    getHeader(headers, "cf-connecting-ip") ||
    getHeader(headers, "true-client-ip") ||
    getHeader(headers, "x-client-ip") ||
    getHeader(headers, "x-log-dot-print-remote-address");
  if (realIp) {
    return realIp.trim();
  }

  if (remoteAddress) {
    return remoteAddress;
  }

  const from = getHeader(headers, "from");
  if (from) {
    return from.trim();
  }

  const host = getHeader(headers, "host");
  if (host) {
    return host.trim();
  }

  return "unknown";
};
