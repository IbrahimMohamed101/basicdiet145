import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ status: false, code: "FORBIDDEN" }, { status: 403 });
  }
  if (!(request.headers.get("content-type") ?? "").startsWith("application/json")) {
    return NextResponse.json({ status: false, code: "UNSUPPORTED_MEDIA_TYPE" }, { status: 415 });
  }
  const backend = process.env.LANDING_ANALYTICS_BACKEND_URL?.replace(/\/+$/, "");
  const secret = process.env.LANDING_ANALYTICS_INGEST_SECRET;
  if (!backend || !/^https:\/\//.test(backend) || !secret) {
    return NextResponse.json({ status: false, code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
  try {
    const payload = await request.text();
    if (payload.length > 2048) return NextResponse.json({ status: false, code: "TOO_LARGE" }, { status: 413 });
    const upstream = await fetch(backend + "/api/landing/leads", {
      method: "POST", cache: "no-store", redirect: "manual", signal: AbortSignal.timeout(7000),
      headers: { "content-type": "application/json", "x-landing-analytics-key": secret },
      body: payload,
    });
    if (upstream.status === 202) {
      return NextResponse.json({ status: true }, { status: 202, headers: { "cache-control": "no-store" } });
    }
    if (upstream.status === 400) {
      const result = await upstream.json().catch(() => ({ error: { code: "INVALID_REQUEST" } }));
      return NextResponse.json({ status: false, code: result.error?.code || "INVALID_REQUEST" }, { status: 400 });
    }
    if (upstream.status === 429) return NextResponse.json({ status: false, code: "RATE_LIMIT" }, { status: 429 });
    return NextResponse.json({ status: false, code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  } catch {
    return NextResponse.json({ status: false, code: "SERVICE_UNAVAILABLE" }, { status: 503 });
  }
}
