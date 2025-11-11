"use server";
import "server-only";
import path from "node:path";
import {
  ensureDir,
  fileExists,
  readJson,
  writeJson,
  writeText,
} from "./utils/cache";

const FIGMA_API = "https://api.figma.com/v1";

type FetchJsonOptions = {
  useCache?: boolean;
};

type FigmaFileResponse = {
  name: string;
  lastModified: string;
  document: unknown;
  components?: Record<string, unknown>;
  styles?: Record<string, unknown>;
  // keep it loose, only need top fields for now
};

function getRequiredEnv(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return val;
}

function authHeaders(): HeadersInit {
  const token = getRequiredEnv("FIGMA_TOKEN");
  return {
    "X-Figma-Token": token,
  };
}

function cachePaths() {
  const root = path.join(process.cwd(), ".cache", "figma");
  const files = path.join(root, "files");
  const svgs = path.join(root, "svgs");
  return { root, files, svgs };
}

/**
 * Fetch Figma file JSON, with simple disk cache.
 * - First tries `.cache/figma/files/<fileKey>--latest.json`
 * - If miss or useCache=false, downloads fresh JSON and writes:
 *   - `<fileKey>--<ISO>.json`
 *   - `<fileKey>--latest.json`
 */
export async function fetchFileJson(
  fileKey: string,
  options: FetchJsonOptions = { useCache: true }
): Promise<FigmaFileResponse> {
  const { files } = cachePaths();
  await ensureDir(files);

  const latestPath = path.join(files, `${fileKey}--latest.json`);

  if (options.useCache !== false && (await fileExists(latestPath))) {
    return readJson<FigmaFileResponse>(latestPath);
  }

  const res = await fetch(`${FIGMA_API}/files/${encodeURIComponent(fileKey)}`, {
    headers: authHeaders(),
    // Explicitly avoid Next caching here, caching to local disk
    cache: "no-store",
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Figma /files failed (${res.status}): ${text}`);
  }

  const json = (await res.json()) as FigmaFileResponse;

  // Persist with versioned filename and "latest"
  const safeTimestamp = json.lastModified.replaceAll(":", "-");
  const versioned = path.join(files, `${fileKey}--${safeTimestamp}.json`);
  await writeJson(versioned, json);
  await writeJson(latestPath, json);

  return json;
}

/**
 * Export a set of node IDs as SVGs (batched), cache results to disk,
 * and return a map nodeId -> local SVG path.
 */
export async function exportNodeSvgs(
  fileKey: string,
  nodeIds: string[],
  options: { batchSize?: number; useCache?: boolean } = {}
): Promise<Record<string, string>> {
  const { svgs } = cachePaths();
  await ensureDir(svgs);

  const batchSize = options.batchSize ?? 40;
  const result: Record<string, string> = {};

  // Determine which node IDs still need fetching
  const missing: string[] = [];
  for (const id of nodeIds) {
    const localPath = svgPathForNode(svgs, fileKey, id);
    if (options.useCache !== false && (await fileExists(localPath))) {
      result[id] = localPath;
    } else {
      missing.push(id);
    }
  }

  // Batch fetch URLs from images endpoint
  for (let i = 0; i < missing.length; i += batchSize) {
    const slice = missing.slice(i, i + batchSize);
    const url = `${FIGMA_API}/images/${encodeURIComponent(
      fileKey
    )}?ids=${encodeURIComponent(slice.join(","))}&format=svg`;

    const res = await fetch(url, { headers: authHeaders(), cache: "no-store" });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Figma /images failed (${res.status}): ${text}`);
    }

    const { images, err } = (await res.json()) as {
      images: Record<string, string | null>;
      err?: string | null;
    };

    if (err) {
      throw new Error(`Figma /images error: ${err}`);
    }

    // Download each SVG and store locally
    for (const nodeId of slice) {
      const remote = images[nodeId];
      if (!remote) continue; // Figma can return null if not exportable

      const svgRes = await fetch(remote, { cache: "no-store" });
      if (!svgRes.ok) {
        console.warn(
          `Failed to download SVG for node ${nodeId}: ${svgRes.status}`
        );
        continue;
      }

      const svgText = await svgRes.text();
      const localPath = svgPathForNode(svgs, fileKey, nodeId);
      await ensureDir(path.dirname(localPath));
      await writeText(localPath, svgText);
      result[nodeId] = localPath;
    }
  }

  return result;
}

function svgPathForNode(svgsRoot: string, fileKey: string, nodeId: string) {
  // Keep a stable, safe filename
  const safeId = nodeId.replaceAll(":", "_");
  const dir = path.join(svgsRoot, fileKey);
  return path.join(dir, `${safeId}.svg`);
}
