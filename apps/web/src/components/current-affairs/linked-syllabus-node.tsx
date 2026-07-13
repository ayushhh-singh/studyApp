import { Link } from "react-router";
import type { Locale } from "@neev/shared";
import { useSyllabusNode } from "@/hooks/use-syllabus-node";

/** One "related syllabus topic" pill in the detail sheet — resolves the node's title/paper via the existing node-detail endpoint. */
export function LinkedSyllabusNode({ nodeId, locale }: { nodeId: string; locale: Locale }) {
  const { data: node, isLoading } = useSyllabusNode(nodeId);

  if (isLoading || !node) {
    return <span className="h-6 w-24 animate-pulse rounded-full bg-muted" />;
  }

  return (
    <Link
      to={`/${locale}/learn/${node.paper_code}/${node.id}`}
      className="rounded-full border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {node.title_i18n[locale]}
    </Link>
  );
}
