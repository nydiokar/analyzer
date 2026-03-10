import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { helpDocs } from "@/lib/help-docs";

export function HelpDocsSidebar({
  currentSlug,
}: {
  currentSlug?: string;
}) {
  return (
    <div className="rounded-[28px] border border-border/60 bg-[rgba(4,10,22,0.72)] p-5 backdrop-blur">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">
            Help Center
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Product guides
          </p>
        </div>
        {!currentSlug ? (
          <Badge variant="secondary" className="rounded-full">
            Start
          </Badge>
        ) : null}
      </div>

      <nav className="space-y-1">
        <Link
          href="/help"
          className={cn(
            "flex items-center justify-between rounded-xl px-3 py-2.5 text-sm transition-colors",
            !currentSlug
              ? "bg-primary text-primary-foreground"
              : "text-foreground/85 hover:bg-white/5 hover:text-foreground",
          )}
        >
          <span>Overview</span>
          {!currentSlug ? (
            <Badge variant="secondary" className="rounded-full text-[10px]">
              Start
            </Badge>
          ) : null}
        </Link>

        {helpDocs.map((doc) => {
          const Icon = doc.icon;
          const isActive = currentSlug === doc.slug;

          return (
            <Link
              key={doc.slug}
              href={`/help/${doc.slug}`}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-foreground/78 hover:bg-white/5 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{doc.title}</span>
            </Link>
          );
        })}
      </nav>

      <div className="mt-5 border-t border-border/60 pt-4 text-sm leading-6 text-muted-foreground">
        Start with the guide that matches the workflow. Read limits before you trust the output.
      </div>
    </div>
  );
}
