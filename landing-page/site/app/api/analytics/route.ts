import { NextRequest, NextResponse } from "next/server";
import { isAllowedSameOrigin } from "@/lib/same-origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // The browser only talks to this same-origin endpoint. The shared secret
  // stays on Railway's server and is never included in public JS.
  // Railway may provide an internal request.nextUrl.origin; the browser sends the public Host.
  if (!isAllowedSameOrigin(request.headers.get("origin"), request.headers.get("host"))) {
    return NextResponse.json({ ok: false }, { status: 403 });
  }
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  const secret = process.env.LANDING_ANALYTICS_INGEST_SECRET;
  if (!backend || !/^https:\/\//.test(backend) || !secret) {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!contentType.startsWith("application/json")) {
    return NextResponse.json({ ok: false }, { status: 415 });
  }
  try {
    const body = await request.text();
    if (body.length > 2048) return NextResponse.json({ ok: false }, { status: 413 });
    const upstream = await fetch(backend + "/api/landing-analytics/events", {
      method: "POST",
      headers: { "content-type": "application/json", "x-landing-analytics-key": secret },
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
    });
    return new NextResponse(null, {
      status: upstream.status === 202 ? 204 : 502,
      headers: { "cache-control": "no-store" },
    });
  } catch {
    return new NextResponse(null, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
