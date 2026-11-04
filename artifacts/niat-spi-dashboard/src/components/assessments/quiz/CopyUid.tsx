import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Older browsers and plain http pages: fall back to a hidden textarea.
    try {
      const box = document.createElement("textarea");
      box.value = text;
      box.setAttribute("readonly", "");
      box.style.position = "fixed";
      box.style.opacity = "0";
      document.body.appendChild(box);
      box.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(box);
      return ok;
    } catch {
      return false;
    }
  }
}

/** The first 8 characters of a UID with a button that copies the full UID. */
export function CopyUid({ uid, className }: { uid: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className="font-mono text-xs text-slate-500" title={uid}>{uid.slice(0, 8)}</span>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          void copyText(uid).then((ok) => ok && setCopied(true));
        }}
        aria-label={copied ? "UID copied" : "Copy full UID"}
        title={copied ? "Copied" : "Copy full UID"}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}
      </button>
      <span role="status" className="sr-only">{copied ? "UID copied" : ""}</span>
    </span>
  );
}
