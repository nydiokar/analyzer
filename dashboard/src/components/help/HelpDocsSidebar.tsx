import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { helpDocs } from "@/lib/help-docs";

export function HelpDocsSidebar({
  currentSlug,
}: {
  currentSlug?: string;
}) {
  return (
    <div className="space-y-4">
      <Card className="overflow-hidden border-border/70 bg-card/70 backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm uppercase tracking-[0.2em] text-muted-foreground">
            Help Center
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          <Link
            href="/help"
            className={cn(
              "flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
              !currentSlug
                ? "bg-primary text-primary-foreground"
                : "hover:bg-muted/60"
            )}
          >
            <span>Overview</span>
            <Badge variant={!currentSlug ? "secondary" : "outline"} className="text-[10px]">
              Start
            </Badge>
          </Link>

          {helpDocs.map((doc) => {
            const Icon = doc.icon;
            const isActive = currentSlug === doc.slug;
            return (
              <Link
                key={doc.slug}
                href={`/help/${doc.slug}`}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "hover:bg-muted/60"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{doc.title}</span>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Card className="border-border/70 bg-gradient-to-br from-sky-500/10 via-cyan-500/5 to-transparent">
        <CardContent className="space-y-2 p-4 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Read this like a product manual.</p>
          <p>
            Start with the tool that matches your job. Then use the limits and expectation notes to avoid bad reads.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
