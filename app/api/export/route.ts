import { todayLocal } from "../../../src/core/months";
import { openDb } from "../../../src/server/db";
import { exportStore } from "../../../src/server/store-io";

export const dynamic = "force-dynamic";

/** GET /api/export: the whole store as one JSON download. */
export function GET(request: Request): Response {
  // A page on another site must not be able to trigger or read this.
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403 });
  const body = JSON.stringify(exportStore(openDb()), null, 2) + "\n";
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="finance-k-${todayLocal()}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
