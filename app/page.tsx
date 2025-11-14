"use client";

import { useState } from "react";

function extractFileKey(input: string): string | null {
  const trimmed = input.trim();

  // If it looks like a bare key (no spaces, no slashes, no "http"), just use it
  if (
    !trimmed.includes("http") &&
    !trimmed.includes("/") &&
    !trimmed.includes(" ")
  ) {
    return trimmed || null;
  }

  // Try to parse as a URL and extract /design/:fileKey/... or /file/:fileKey/...
  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean); // remove empty

    // Look for "design" or "file" segment and take the next one as fileKey
    const designIdx = segments.findIndex(
      (seg) => seg.toLowerCase() === "design" || seg.toLowerCase() === "file"
    );
    if (designIdx >= 0 && segments[designIdx + 1]) {
      return segments[designIdx + 1];
    }

    return null;
  } catch {
    // Not a URL and not a clean key → unknown format
    return null;
  }
}

export default function HomePage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | any>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setResult(null);

    const key = extractFileKey(input);
    if (!key) {
      setLoading(false);
      setError("Could not extract a Figma file key from that input.");
      return;
    }

    try {
      const res = await fetch("/api/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileKey: key }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Request failed");
      setResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const outputUrl: string | undefined = result?.output?.url;

  return (
    <main className="min-h-screen p-8 bg-gray-50 text-gray-900">
      <div className="max-w-xl mx-auto space-y-6">
        <h1 className="text-2xl font-semibold">Figma → HTML/CSS Pipeline</h1>

        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block">
            <span className="text-sm font-medium">Figma file URL or key</span>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="https://www.figma.com/design/MxMXpjiLPbdHlratvH0Wdy/… or MxMXpjiLPbdHlratvH0Wdy"
              className="mt-1 w-full rounded-md border border-gray-300 p-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </label>

          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? "Converting…" : "Run conversion"}
          </button>
        </form>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 p-3 rounded-md">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            {outputUrl && (
              <a
                href={outputUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-block"
              >
                <button className="rounded-md bg-green-600 px-4 py-2 text-white hover:bg-green-700">
                  Open generated preview
                </button>
              </a>
            )}

            <pre className="bg-white border border-gray-200 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
