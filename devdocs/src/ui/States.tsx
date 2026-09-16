import type { ReactNode } from "react";
import { AlertCircle, SearchX } from "lucide-react";
import { Button } from "../components/ui/index.js";

const MESSAGE = "flex min-h-56 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground";

export function LoadingRows() {
  return <div className="py-1.5" aria-label="Loading content" role="status">
    {Array.from({ length: 9 }, (_, i) => <div key={i} className="flex items-center gap-2.5 border-b border-border-subtle py-[7px]">
      <span className="block size-8 animate-pulse rounded-sm bg-secondary" />
      <span className="block h-[11px] w-[35%] animate-pulse rounded-sm bg-secondary" />
      <span className="ml-auto block h-[9px] w-[15%] animate-pulse rounded-sm bg-secondary" />
    </div>)}
  </div>;
}

export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className={MESSAGE} role="alert">
    <AlertCircle size={26} />
    <h2 className="text-[13px] font-semibold text-foreground">Could not load this content</h2>
    <p className="max-w-md text-xs leading-normal">{message}</p>
    {retry && <Button variant="secondary" size="sm" onClick={retry}>Try again</Button>}
  </div>;
}

export function EmptyState({ title = "No matching records", children }: { title?: string; children?: ReactNode }) {
  return <div className={MESSAGE}>
    <SearchX size={27} />
    <h2 className="text-[13px] font-semibold text-foreground">{title}</h2>
    <p className="max-w-md text-xs leading-normal">{children ?? "Try another name, ID or type."}</p>
  </div>;
}

/** A one-line note where a list or section has nothing to show. */
export function EmptyNote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={`py-1 text-xs text-faint ${className ?? ""}`.trim()}>{children}</p>;
}
