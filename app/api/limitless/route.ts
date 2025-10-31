import { NextResponse } from "next/server";

const BASE_URL = "https://api.limitless.exchange/api-v1";

export async function GET() {
  try {
    // Попробуем 3 популярных эндпоинта Limitless
    const endpoints = ["/markets", "/market", "/market/all"];
    let data: unknown = null;
    let lastErr: string | null = null;

    for (const path of endpoints) {
      try {
        const res = await fetch(`${BASE_URL}${path}`, {
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "EscanorTerminal/1.0 (Next.js)",
          },
          cache: "no-store",
        });

        if (res.ok) {
          data = await res.json();
          console.log(`✅ Limitless OK: ${path}`);
          break;
        }

        lastErr = `❌ ${path} returned ${res.status}`;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
      }
    }

    if (!data) {
      throw new Error(lastErr || "No data from Limitless");
    }

    return NextResponse.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Limitless Proxy Fatal:", err);
    return NextResponse.json(
      { error: `Limitless API proxy failed: ${message}` },
      { status: 500 }
    );
  }
}
