import { signOut } from "@workos-inc/authkit-nextjs";
import Link from "next/link";

export function Header({ email }: { email: string }) {
  return (
    <header className="border-b border-stone-300 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-lg font-bold tracking-tight">LegacyMind</span>
          <span className="text-sm text-stone-500">verification dashboard</span>
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-stone-500">{email}</span>
          <form
            action={async () => {
              "use server";
              await signOut();
            }}
          >
            <button
              type="submit"
              className="rounded border border-stone-300 px-3 py-1 text-stone-700 hover:bg-stone-100"
            >
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}

const VERDICT_STYLES: Record<string, string> = {
  CERTIFIED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  NOT_CERTIFIED: "bg-red-100 text-red-800 border-red-300",
  PASS: "bg-emerald-100 text-emerald-800 border-emerald-300",
  FAIL: "bg-red-100 text-red-800 border-red-300",
  NOT_RUN: "bg-stone-100 text-stone-500 border-stone-300",
  DIVERGENT: "bg-red-100 text-red-800 border-red-300",
  VERIFIED: "bg-emerald-100 text-emerald-800 border-emerald-300",
  UNREALIZED: "bg-amber-100 text-amber-800 border-amber-300",
  "NOT-APPLICABLE": "bg-stone-100 text-stone-500 border-stone-300",
};

export function Badge({ value }: { value: string }) {
  const style = VERDICT_STYLES[value] ?? "bg-stone-100 text-stone-600 border-stone-300";
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-semibold ${style}`}>
      {value}
    </span>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-stone-100 px-1 py-0.5 font-mono text-xs">{children}</code>;
}

export const shortHash = (h?: string | null): string => (h ? `${h.slice(0, 16)}…` : "n/a");
