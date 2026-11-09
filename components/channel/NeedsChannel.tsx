import Link from "next/link";

/** In place of uploading or the studio for an account without a channel (036). */
export function NeedsChannel({ next, what }: { next: string; what: string }) {
  return (
    <div className="mx-auto max-w-[560px] px-4 py-16 text-center" data-needs-channel>
      <h1 className="text-[24px] font-normal leading-8 text-text">Create a channel first</h1>
      <p className="mt-3 text-[15px] leading-6 text-text-2">
        To {what}, you need a channel. Your account can watch, like, subscribe and comment without one.
      </p>
      <Link href={`/account/create-channel?next=${encodeURIComponent(next)}`} className="btn-blue mt-6">
        Create a channel
      </Link>
    </div>
  );
}
