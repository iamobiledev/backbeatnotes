import { Skeleton } from "@/components/ui/skeleton";

export default function WorkspaceLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-10" aria-busy aria-label="Loading">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-9 w-56" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>
      <div>
        <Skeleton className="h-4 w-20" />
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {[...Array(4)].map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      </div>
      <div>
        <Skeleton className="h-4 w-24" />
        <div className="mt-3 space-y-px overflow-hidden rounded-lg">
          {[...Array(5)].map((_, index) => (
            <Skeleton key={index} className="h-12 w-full rounded-none" />
          ))}
        </div>
      </div>
    </div>
  );
}
