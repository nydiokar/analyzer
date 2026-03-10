'use client';

import Link from "next/link";
import { HelpCircle } from "lucide-react";

import { Button } from "@/components/ui/button";

export function FeatureHelpLink({
  slug,
  label = "Docs",
}: {
  slug: string;
  label?: string;
}) {
  return (
    <Button variant="outline" size="sm" asChild className="h-8 rounded-full">
      <Link href={`/help/${slug}`}>
        <HelpCircle className="mr-1.5 h-3.5 w-3.5" />
        {label}
      </Link>
    </Button>
  );
}
