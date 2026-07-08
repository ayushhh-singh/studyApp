/**
 * Resolve a syllabus node to its OWN id plus every descendant id (its subtree),
 * using the materialized `path`. PYQs and current-affairs items attach to LEAF
 * topics, so anything node-scoped that must work for a chapter (non-leaf) node —
 * the node-detail PYQ/CA tabs, `?node=` browsing, "Practice this topic" — has to
 * query the whole subtree, not just the exact node (which for a chapter is
 * always empty).
 *
 * For a leaf node the subtree is just `[nodeId]`, so callers get the previous
 * own-node behaviour unchanged.
 */
import { supabase } from "./supabase.js";

export async function resolveSubtreeNodeIds(nodeId: string): Promise<string[]> {
  const { data: node, error } = await supabase()
    .from("syllabus_nodes")
    .select("paper_code, path")
    .eq("id", nodeId)
    .maybeSingle();
  if (error) throw new Error(`subtree node lookup failed: ${error.message}`);
  if (!node) return [nodeId];

  const paperCode = (node as { paper_code: string }).paper_code;
  const path = ((node as { path: string | null }).path ?? "") as string;

  const { data: all, error: allErr } = await supabase()
    .from("syllabus_nodes")
    .select("id, path")
    .eq("paper_code", paperCode);
  if (allErr) throw new Error(`subtree scan failed: ${allErr.message}`);

  // The `${path}/` trailing slash prevents "1/2" from matching "1/20"; a root
  // node (path "") matches every node in the paper.
  const prefix = path ? `${path}/` : "";
  const ids = ((all ?? []) as { id: string; path: string }[])
    .filter((r) => r.path === path || (prefix ? r.path.startsWith(prefix) : true))
    .map((r) => r.id);

  return ids.length > 0 ? ids : [nodeId];
}
