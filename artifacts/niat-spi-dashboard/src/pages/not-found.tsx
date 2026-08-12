import { Link } from "wouter";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <AlertCircle className="mx-auto h-10 w-10 text-brand-600" />
        <h1 className="mt-4 text-2xl font-semibold text-slate-900">Page not found</h1>
        <p className="mt-2 text-sm text-slate-600">
          The page you requested does not exist or has moved.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link href="/">
            <Button variant="outline">Go to home</Button>
          </Link>
          <Link href="/dashboard">
            <Button className="bg-brand-600 text-white hover:bg-brand-700">
              Open dashboard
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
