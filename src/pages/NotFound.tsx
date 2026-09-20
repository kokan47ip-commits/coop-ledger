import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 text-center text-foreground">
      <span className="brand-gradient mb-8 flex size-9 items-center justify-center rounded-lg text-[10px] font-semibold tracking-wide text-white shadow-lg shadow-primary/40">
        IAS
      </span>
      <p className="font-mono text-[11px] uppercase tracking-[0.24em] text-muted-foreground">
        Error 404
      </p>
      <h1 className="mt-4 text-3xl font-semibold tracking-tight md:text-4xl">
        This page is not on the books.
      </h1>
      <p className="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
        The address you followed doesn't exist in the workspace. Return to your
        dashboard to continue where you left off.
      </p>
      <Button asChild className="mt-9 rounded-lg px-7">
        <Link to="/dashboard">
          <ArrowLeft className="size-4" /> Back to dashboard
        </Link>
      </Button>
    </div>
  );
}
