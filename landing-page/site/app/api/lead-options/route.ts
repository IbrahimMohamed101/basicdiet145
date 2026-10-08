import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  if (!backend || !/^https:\/\//.test(backend)) {
    return NextResponse.json({ status: false, data: [] }, { status: 503 });
  }
  try {
    const upstream = await fetch(backend + "/api/landing/options", {
      cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) throw new Error("BACKEND_UNAVAILABLE");
    const result = await upstream.json();
    return NextResponse.json({ status: true, data: result.data ?? [] },
      { headers: { "cache-control": "private, no-store" } });
  } catch {
    return NextResponse.json({ status: false, data: [] }, { status: 503 });
  }
}
