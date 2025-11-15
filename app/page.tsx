"use client";

import { useEffect, useRef, useState } from "react";
import { extractFileKey } from "./lib/utils/helper";

const STORAGE_KEY = "figma-convert-ui-v1";

export default function HomePage() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<null | any>(null);
  const [error, setError] = useState<string | null>(null);

  // Keep track of the current request to avoid race conditions
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const raw =
        typeof window !== "undefined"
          ? window.localStorage.getItem(STORAGE_KEY)
          : null;
      if (!raw) return;

      const parsed = JSON.parse(raw) as {
        input?: string;
        result?: any;
        error?: string | null;
      };

      if (parsed.input) setInput(parsed.input);
      if (parsed.result) setResult(parsed.result);
      if (typeof parsed.error === "string") setError(parsed.error);
    } catch {
      // ignore bad data
    }
  }, []);

  // --- persist state whenever it changes ---
  useEffect(() => {
    if (typeof window === "undefined") return;
    const payload = JSON.stringify({
      input,
      result,
      error,
    });
    window.localStorage.setItem(STORAGE_KEY, payload);
  }, [input, result, error]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    // cancel any previous in-flight request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

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
        signal: controller.signal,
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.message || "Request failed");
      setResult(json);
    } catch (err: any) {
      if (err?.name === "AbortError") {
        return;
      }
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
              placeholder="Enter a Figma file URL or file key"
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
            <pre className="bg-white border border-gray-200 rounded-md p-3 text-xs overflow-x-auto whitespace-pre-wrap">
              {JSON.stringify(result, null, 2)}
            </pre>
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
          </div>
        )}
      </div>
    </main>
  );
}
