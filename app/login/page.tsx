import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AuthCard, DbNotConnected, FeatureOff, FormSkeleton } from "@/components/auth/AuthCard";
import { LoginForm } from "@/components/auth/LoginForm";
import { AccountList } from "@/components/switch/AccountList";
import { safeNext } from "@/lib/accounts/redirect";
import { accountsState as signInState } from "@/lib/accounts/server";
import { accountsState } from "@/lib/switch/server";
import { yapinNote } from "@/lib/yapin/rules";
import { yapinSignIn } from "@/lib/yapin/server";

export const metadata = { title: "Sign in | PlayPulse" };

const callbackError = "Sign in did not finish. Try again.";
/** proxy.ts sends a banned account here once it has signed it out (feature 14). */
const bannedError = "This account has been banned for breaking the rules.";

async function LoginGate({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNext(params.next);
  const state = await signInState();
  if (state.kind === "no-db") return <DbNotConnected />;
  if (state.kind === "off") return <FeatureOff />;
  if (state.user) redirect(state.user.onboarded ? next : "/welcome");
  const yapin = (await yapinSignIn(null)) !== null;
  const note = typeof params.yapin === "string" ? yapinNote(params.yapin) : null;
  // Accounts still signed in on this browser (Switch account): one click away.
  const waiting = await accountsState();
  const saved = waiting.kind === "ready" ? waiting.accounts : [];
  return (
    <>
      {params.add ? (
        <p className="-mt-4 mb-6 text-center text-[14px] text-text-2" data-add-account>
          Sign in to another account. You can switch back from the account menu.
        </p>
      ) : null}
      {saved.length > 0 && (
        <div className="mb-6" data-saved-accounts>
          <p className="mb-1 text-[14px] font-medium text-text">Choose an account</p>
          <div className="-mx-4 rounded-sm">
            <AccountList accounts={saved} next={next} forget />
          </div>
          <p className="mt-4 text-[14px] text-text-2">Or sign in to another account:</p>
        </div>
      )}
      <LoginForm
        next={next}
        yapin={yapin}
        initialError={params.banned ? bannedError : params.error ? callbackError : note}
      />
    </>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <AuthCard title="Sign in" subtitle="to continue to PlayPulse">
      <Suspense fallback={<FormSkeleton />}>
        <LoginGate searchParams={searchParams} />
      </Suspense>
    </AuthCard>
  );
}
