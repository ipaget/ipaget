// Transport-level failures (a dropped connection, a reset, a timeout) look like
// cryptic chained errors to users. They come from the network path rather than
// from the request itself, so they deserve a short actionable hint in front of
// the original text, which is kept for diagnostics.
const TRANSPORT_MARKERS = [
  "round trip: eof",
  "unexpected eof",
  "connection reset",
  "broken pipe",
  "i/o timeout",
  "network timeout",
  "connection refused",
  "no such host",
  "tls handshake",
];

export function isTransportError(message: string | undefined | null): boolean {
  if (!message) {
    return false;
  }

  const lower = message.toLowerCase();
  return TRANSPORT_MARKERS.some((marker) => lower.includes(marker));
}

export function withNetworkHint(message: string, hint: string): string {
  return isTransportError(message) ? `${hint}\n\n${message}` : message;
}
