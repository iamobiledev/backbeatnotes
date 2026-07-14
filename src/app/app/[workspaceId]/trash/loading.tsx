import { Skeleton } from "@/components/ui/skeleton";

export default function TrashLoading() {
  return (
    <div className="mx-auto max-w-3xl" aria-busy aria-label="Loading trash">
      <Skeleton className="h-9 w-32" />
      <Skeleton className="mt-2 h-4 w-80" />
      <div className="mt-6 space-y-px overflow-hidden rounded-lg">
        {[...Array(4)].map((_, index) => (
          <Skeleton key={index} className="h-14 w-full rounded-none" />
        ))}
      </div>
    </div>
  );
}
