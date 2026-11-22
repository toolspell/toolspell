/**
 * Cookies do not isolate ports, so without this a page on another localhost port
 * could open this server's socket or pair with the user's session cookie. Browsers
 * always send `Origin` on WebSocket upgrades and POSTs; a request without one comes
 * from a non-browser client, which has no ambient cookie to abuse.
 */
export const isAllowedOrigin = (request: {
  readonly origin: string | undefined;
  readonly host: string | undefined;
  readonly webOrigin: string;
}): boolean => {
  if (request.origin === undefined) return true;
  let origin: URL;
  try {
    origin = new URL(request.origin);
  } catch {
    return false;
  }
  if (origin.origin === new URL(request.webOrigin).origin) return true;
  // Same-origin: the page was served by this server, possibly under another host name.
  return request.host !== undefined && origin.host === request.host;
};
