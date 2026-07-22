import { Loader2 } from "lucide-react";

export function PageLoader({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-gray-400">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export function ErrorState({ message }: { message?: string }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
      {message ?? "Something went wrong while loading this data. Please try again."}
    </div>
  );
}
