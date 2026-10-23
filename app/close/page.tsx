import { redirect } from "next/navigation";
import { isMonth, todayLocal } from "../../src/core/months";
import { defaultCloseMonth } from "../../src/server/view";

export const dynamic = "force-dynamic";

export default async function CloseIndex({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  redirect(`/close/${sp.month && isMonth(sp.month) ? sp.month : defaultCloseMonth(todayLocal())}`);
}
