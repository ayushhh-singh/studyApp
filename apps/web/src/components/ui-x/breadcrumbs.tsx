import { Fragment } from "react";
import { Link } from "react-router";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items, className }: { items: BreadcrumbItem[]; className?: string }) {
  return (
    <nav
      aria-label="Breadcrumb"
      className={cn("flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm text-muted-foreground", className)}
    >
      {items.map((item, index) => (
        <Fragment key={index}>
          {index > 0 && <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
          {item.to ? (
            <Link
              to={item.to}
              className="truncate rounded-sm hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {item.label}
            </Link>
          ) : (
            <span className="truncate font-medium text-foreground" aria-current="page">
              {item.label}
            </span>
          )}
        </Fragment>
      ))}
    </nav>
  );
}
