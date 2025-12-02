'use client';

import { TopHoldersPanel } from '@/components/similarity-lab/TopHoldersPanel';
import { Card } from '@/components/ui/card';

export default function TopHoldersToolPage() {
  return (
    <div className="container mx-auto p-4 md:p-5">
      <header className="mb-6">
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
          Top Holders Utility <span className="text-muted-foreground">— fetch owners by token</span>
        </h1>
      </header>
      <Card className="p-4">
        {/* Make the list fill most of viewport height while staying scrollable */}
        <TopHoldersPanel maxHeightClass="max-h-[73vh]" />
      </Card>
    </div>
  );
}


