import { createFileRoute, Link } from "@tanstack/react-router";
import { GROK_PROVIDERS, authEnabled, signIn } from "@/lib/auth/client";

export const Route = createFileRoute("/login")({ component: Login });

function Login() {
  return (
    <main className="grid min-h-dvh place-items-center bg-bg px-6 text-fg">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-8">
        <p className="font-display text-xs font-semibold tracking-[0.28em] text-muted uppercase">
          Wakepoint
        </p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          Save your name to the high-score board. Play still works as a guest.
        </p>
        <div className="mt-6 flex flex-col gap-3">
          {authEnabled ? (
            GROK_PROVIDERS.map((p) => (
              <button
                key={p.providerId}
                type="button"
                onClick={() => signIn(p.providerId, { callbackURL: "/" })}
                className="h-11 rounded-md bg-primary px-4 text-sm font-medium text-primary-fg transition-opacity hover:opacity-90"
              >
                Continue with {p.label}
              </button>
            ))
          ) : (
            <p className="text-sm text-muted">Sign-in is disabled.</p>
          )}
        </div>
        <Link
          to="/"
          className="mt-6 inline-block text-sm text-muted underline-offset-4 hover:text-fg hover:underline"
        >
          Back to flight deck
        </Link>
      </div>
    </main>
  );
}
