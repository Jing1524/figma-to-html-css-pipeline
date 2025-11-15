export function extractFileKey(input: string): string | null {
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
