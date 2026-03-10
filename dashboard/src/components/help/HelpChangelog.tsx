import { History } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { changelog } from "@/lib/changelog";

export function HelpChangelog() {
  return (
    <div className="text-center text-sm text-muted-foreground">
      <Popover>
        <PopoverTrigger asChild>
          <button className="mx-auto flex items-center gap-2 transition-colors hover:text-foreground">
            <History className="h-4 w-4" />
            <span>Last updated: {changelog[0].date} (View Changelog)</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[500px]" side="top" align="center">
          <div className="grid gap-4">
            <div className="space-y-2">
              <h4 className="font-medium leading-none">Changelog</h4>
              <p className="text-sm text-muted-foreground">
                Recent updates to the platform.
              </p>
            </div>
            <div className="grid max-h-[400px] gap-3 overflow-y-auto pr-2">
              {changelog.map((entry) => (
                <div key={entry.version} className="grid grid-cols-[1fr_auto] items-start gap-4 rounded-md p-3 hover:bg-muted/50">
                  <div className="grid gap-2">
                    <p className="text-sm font-semibold">{entry.version}</p>
                    <ul className="list-none space-y-1 text-xs text-muted-foreground">
                      {entry.changes.map((change, index) => (
                        <li key={index} className="leading-relaxed">
                          {change}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="whitespace-nowrap text-xs text-muted-foreground">
                    {entry.date}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
