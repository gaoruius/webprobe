// Serves screenshots saved in a run folder. Only plain .png names, so a request can't
// reach outside the folder.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { RUNS_DIR } from "@/lib/runs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await params;
  if (!/^[\w-]+$/.test(id) || !/^[\w-]+\.png$/.test(name)) return new Response("Not found", { status: 404 });
  const file = path.join(RUNS_DIR, id, name);
  if (!existsSync(file)) return new Response("Not found", { status: 404 });
  return new Response(readFileSync(file), {
    headers: { "content-type": "image/png", "cache-control": "public, max-age=31536000, immutable" },
  });
}
