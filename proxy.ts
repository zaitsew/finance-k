import { NextResponse, type NextRequest } from "next/server";

/**
 * Finance K holds one person's balances and listens on 127.0.0.1 only. This refuses any request
 * whose Host header is not a loopback name, which closes DNS-rebinding: a web page cannot point
 * its own domain at this port and read the data through the browser.
 */
const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/;

export function proxy(request: NextRequest) {
  const host = request.headers.get("host") ?? "";
  if (!LOOPBACK.test(host)) return new NextResponse("Finance K only answers on 127.0.0.1.", { status: 403 });
  return NextResponse.next();
}

export const config = { matcher: "/((?!_next/static|_next/image).*)" };
