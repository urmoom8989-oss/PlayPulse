"use client";

import { useState, type FormEvent } from "react";
import { handleNote, useHandleCheck } from "@/components/studio/useHandleCheck";
import { TextField, FormError } from "@/components/auth/fields";
import { channelErrorText, normalizeHandle } from "@/lib/channels/validation";
import { Avatar } from "../Avatar";

/** "Create a channel" (036): a name and a handle, both filled in from the account to start with. */
export function CreateChannelForm({
  defaultName,
  defaultHandle,
  avatarUrl,
  next,
}: {
  defaultName: string;
  defaultHandle: string;
  avatarUrl: string | null;
  /** Where to go after: the page that asked for a channel, else the new channel. */
  next: string | null;
}) {
  const [name, setName] = useState(defaultName);
  const [handle, setHandle] = useState(defaultHandle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useHandleCheck(handle, "");
  const note = handleNote(status);
  const nameProblem = name.trim().length > 50 ? "Channel names are up to 50 characters." : null;
  const blocked = busy || !name.trim() || Boolean(nameProblem) || status.state === "invalid" || status.state === "taken";

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocked) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/channel/create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: name.trim(), handle: normalizeHandle(handle) }),
    }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { handle?: string; error?: string } | null;
    if (!res?.ok || !json?.handle) {
      setBusy(false);
      setError(json?.error === "has_channel" ? channelErrorText("has_channel") : channelErrorText(json?.error ?? "failed"));
      return;
    }
    // A full load, so the menu and the guide pick up the new channel.
    window.location.assign(next ?? `/@${json.handle}`);
  }

  return (
    <form onSubmit={submit} className="space-y-6" data-create-channel>
      <div className="flex justify-center">
        <Avatar name={name || defaultName} url={avatarUrl} size={96} />
      </div>
      <FormError message={error} />
      <TextField
        label="Channel name"
        value={name}
        maxLength={60}
        onChange={(e) => setName(e.target.value)}
        error={nameProblem}
        hint="You can change it later in Studio."
        data-channel-name
      />
      <TextField
        label="Handle"
        value={handle}
        maxLength={31}
        onChange={(e) => setHandle(e.target.value)}
        error={note.error}
        hint={note.hint ?? "Your channel's address: /@handle."}
        data-channel-handle
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-text" onClick={() => window.history.back()}>
          Cancel
        </button>
        <button type="submit" className="btn-blue" disabled={blocked} data-create-channel-submit>
          {busy ? "Creating..." : "Create channel"}
        </button>
      </div>
    </form>
  );
}
