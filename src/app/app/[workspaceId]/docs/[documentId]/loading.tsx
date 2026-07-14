import { Skeleton } from "@/components/ui/skeleton";

export default function DocumentLoading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy aria-label="Loading page">
      <div className="mb-6 flex items-center justify-between gap-3">
        <Skeleton className="h-5 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-9 rounded-md" />
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-md" />
      <Skeleton className="mt-6 h-11 w-2/3" />
      <div className="mt-6 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-11/12" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}
