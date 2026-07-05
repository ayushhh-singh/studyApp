import type { ExamStage, SyllabusNode } from "@prayasup/shared";
import { supabase } from "../lib/supabase.js";
import { HttpError } from "../lib/http-error.js";

interface SyllabusRow {
  id: string;
  exam_stage: ExamStage;
  paper_code: string;
  title_i18n: SyllabusNode["title_i18n"];
  description_i18n: SyllabusNode["description_i18n"];
  order_index: number;
  depth: number;
  path: string;
  parent_id: string | null;
}

function buildTree(rows: SyllabusRow[]): SyllabusNode[] {
  const byId = new Map<string, SyllabusNode>();
  for (const r of rows) {
    byId.set(r.id, {
      id: r.id,
      exam_stage: r.exam_stage,
      paper_code: r.paper_code,
      title_i18n: r.title_i18n,
      description_i18n: r.description_i18n,
      order_index: r.order_index,
      depth: r.depth,
      path: r.path,
      children: [],
    });
  }
  const roots: SyllabusNode[] = [];
  for (const r of rows) {
    const node = byId.get(r.id)!;
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export async function getSyllabusTree(stage?: ExamStage): Promise<SyllabusNode[]> {
  let query = supabase()
    .from("syllabus_nodes")
    .select("id, exam_stage, paper_code, title_i18n, description_i18n, order_index, depth, path, parent_id")
    .order("paper_code", { ascending: true })
    .order("order_index", { ascending: true });
  if (stage) query = query.eq("exam_stage", stage);

  const { data, error } = await query;
  if (error) throw new HttpError(500, `syllabus query failed: ${error.message}`);
  return buildTree((data ?? []) as SyllabusRow[]);
}
