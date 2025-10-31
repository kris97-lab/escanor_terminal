import { NextResponse } from "next/server";

const BASE_URL = "https://api.limitless.exchange/api-v1";

export async function GET() {
  try {
    const res = await fetch(`${BASE_URL}/markets`, {
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`Limitless API returned ${res.status}`);
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Limitless API proxy error:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
