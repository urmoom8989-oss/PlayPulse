# Set up the encoder box

The encoder turns uploaded videos into something people can stream: HLS at
360p, 720p and 1080p (only the sizes the upload can fill; below 720p at most
30 fps, 720p and up at the upload's frame rate), three thumbnails, a hover
preview sprite and auto-generated captions. It runs on its own server,
separate from the website, because encoding keeps every CPU core busy.

It takes about 15 minutes. You need:

- a [Hetzner Cloud](https://console.hetzner.cloud/) account
- the Supabase **secret key** (service role) from the
  [API keys page](https://supabase.com/dashboard/project/_/settings/api-keys)
- the R2 bucket and an R2 API token (see [Uploads (R2)](../../docs/features.md#uploads-r2) in the feature docs)
- migration `supabase/migrations/006_processing.sql` applied (see step 6)

How it works once it is set up: the worker asks the database for a job every
5 seconds. When someone finishes an upload it downloads the file from R2,
encodes it, uploads the result to `hls/<video id>/` in the same bucket and marks
the video ready. Then it listens to the video with a speech model and adds the
captions (see [Auto-generated captions](#auto-generated-captions)). One video at a time. When you push `main` to `release` and the
worker code changed, GitHub builds a new image and the box switches to it within
5 minutes, but never in the middle of an encode.

---

## 1. Create the server

1. Open the [Hetzner Cloud console](https://console.hetzner.cloud/) and pick your project.
2. Click **Add Server**.
3. Location: the same as the website, for example **Helsinki**.
4. Image: **Ubuntu 24.04**.
5. Type: **CPX31** (4 shared vCPU, 8 GB memory, 160 GB disk). Shared vCPU is fine
   for this.
6. SSH key: add your public key. No key yet? Follow
   [GitHub's guide to creating an SSH key](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent).
7. Click **Create & Buy now** and copy the server's **IPv4 address**.

The encoder only makes outgoing connections (to Supabase and R2), so it needs no
domain and no open ports besides SSH.

Hetzner docs: [Creating a server](https://docs.hetzner.com/cloud/servers/getting-started/creating-a-server/)

**How fast is it?** On a CPX31 a 10 minute 1080p video takes roughly 10 to 15
minutes: about as long as the video itself, a bit more for busy footage. A 720p
video takes about half that. Jobs wait in line, so a busy day means a longer
wait, not errors. A job may take 1 hour plus twice the video's length (at least
2 and at most 12 hours), so a 3 hour upload gets 7 hours before it is stopped.
The studio's progress bar moves during the whole encode.

## 2. Log in to the server

Replace `YOUR_SERVER_IP` with the address from step 1:

```bash
ssh root@YOUR_SERVER_IP
```

Type `yes` if it asks about the fingerprint.

## 3. Create the settings file

```bash
mkdir -p /opt/sloptube-encoder
nano /opt/sloptube-encoder/.env
```

Paste this and fill in your values after each `=` (every setting is also
explained in [`worker/.env.example`](../../worker/.env.example)):

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=

# Optional:
# WORKER_NAME=encoder-1
# ENCODE_SLOTS=2
# START_WAIT_S=20
# MEDIA_PUBLIC_URL=https://media.example.com
# SITE_URL=https://tube.example.com
```

Save with `Ctrl+O`, `Enter`, and leave with `Ctrl+X`.

Where each value comes from:

| Name | Where to find it |
| --- | --- |
| `SUPABASE_URL` | [API settings](https://supabase.com/dashboard/project/_/settings/api), **Project URL** |
| `SUPABASE_SERVICE_ROLE_KEY` | [API keys](https://supabase.com/dashboard/project/_/settings/api-keys), a **Secret key** (or the legacy `service_role` key) |
| `R2_ACCOUNT_ID` | the [R2 overview page](https://dash.cloudflare.com/?to=/:account/r2/overview), **Account ID** |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | [Manage R2 API Tokens](https://dash.cloudflare.com/?to=/:account/r2/api-tokens), **Create API token** with **Object Read & Write** on the video bucket only. A separate token for the encoder makes it easy to revoke. |
| `R2_BUCKET` | the name of the video bucket, the same as the website uses |
| `WORKER_NAME` | optional, shown in the `encode_jobs.worker` column. Defaults to the server's name. Give every encoder box its own. With more than one slot each slot adds `/1`, `/2`. |
| `START_WAIT_S` | optional. Seconds the worker waits at start before it takes a job, default 20. During an update the old worker runs a few seconds longer and gives its jobs back when it stops; without the wait both could work on the same video. |
| `ENCODE_SLOTS` | optional, 1 to 4, default 2. With migration 039 (smart order) slot 1 makes each new upload's 360p, one after the other, and slot 2 makes 720p and up, one video at a time, at the lowest CPU priority, so it gets the whole box while no upload is waiting and steps aside when one comes in. With 1 the box does both in turn, every waiting 360p first. Two encodes at the same priority each ran about 3.5 times slower on an 8 CPU box, which is why HD steps aside. Without 039 the slots each take any video (037); without 037, one at a time. |
| `MEDIA_PUBLIC_URL` | optional. If you connect a [custom domain to the bucket](https://developers.cloudflare.com/r2/buckets/public-buckets/), put it here and `thumbnail_url` is filled in. Without it the site serves the thumbnail through `/api/media`. Use the same value on the website (see "Watch page" in the main README). |
| `SITE_URL` | optional. The website's address, like `https://tube.example.com`, without a slash at the end. The encoder needs it for the links in Yapin' announcements (feature 16, see "Yapin'" in the main README). Without it no announcements are posted. |
| `CAPTIONS` | optional. `off` turns the auto-generated captions off. The image sets everything else they need. |
| `CAPTIONS_THREADS` | optional. CPU threads for speech to text. Defaults to the number of CPUs, at most 8. |

**The secret key can read and change everything in the database.** It lives only
in this file on this box: never in the repository, never in a chat, and in the
website's `.env` only if you switch on Sign in with Yapin' (feature 16, see
[`docs/launch.md`](../../docs/launch.md#yapin)). If it ever leaks, roll it on the API keys page and paste the new
one here.

## 4. Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/myfilehero/sloptube/main/ops/encoder/install.sh -o install.sh
bash install.sh
```

It installs Docker, the `sloptube-encoder` service (starts on boot), log rotation
and a timer that checks for a new image every 5 minutes. Running it again is safe.

## 5. Let the box pull the image

The image is `ghcr.io/myfilehero/sloptube-encoder`. GitHub builds it the first
time `worker/` reaches the `release` branch. You can also start a build by hand:
**Actions > encoder > Run workflow** on the
[Actions page](https://github.com/myfilehero/sloptube/actions/workflows/encoder.yml).

Then make the package public so the box can pull it without a login:
[Your packages](https://github.com/myfilehero?tab=packages) >
**sloptube-encoder** > **Package settings** > **Change visibility** > **Public**.
GitHub docs: [Configuring a package's visibility](https://docs.github.com/en/packages/learn-github-packages/configuring-a-packages-access-control-and-visibility).

Within 5 minutes the box pulls it and starts the worker. To not wait, run:

```bash
sloptube-encoder-update && systemctl start sloptube-encoder
```

## 6. Switch processing on

1. Run `supabase/migrations/006_processing.sql` in the
   [SQL editor](https://supabase.com/dashboard/project/_/sql/new)
   (after 001 to 005).
2. In the [table editor](https://supabase.com/dashboard/project/_/editor),
   open `feature_flags` and set the `processing` row to `test` (with your user id
   in `users`) or `everyone`.

While the flag is `off` the worker takes no jobs. In `test` mode it only encodes
videos of the listed users. Uploads made before the flag was on wait in line and
start as soon as it is.

## 7. Watch the log

```bash
docker logs -f sloptube-encoder
```

One line per step, for example:

```
2026-11-04T10:00:00.000Z captions threads=8 on with speech.bin and vad.bin, checked in 3.1s
2026-11-04T10:00:00.000Z start worker=encoder-1 polling every 5s
2026-11-04T10:02:11.000Z claim job=1a2b3c4d video=5e6f7a8b attempt=1 worker=encoder-1 uploads/.../source.mp4
2026-11-04T10:02:11.200Z head job=1a2b3c4d video=5e6f7a8b source is 812.4 MB, size matches
2026-11-04T10:02:25.900Z download job=1a2b3c4d video=5e6f7a8b 812.4 MB in 14.7s
2026-11-04T10:02:26.100Z probe job=1a2b3c4d video=5e6f7a8b duration=600.0 size=1920x1080 audio=true renditions 360p(640x360) 720p(1280x720) 1080p(1920x1080)
2026-11-04T10:13:40.000Z encode job=1a2b3c4d video=5e6f7a8b 3 renditions in 674.0s
2026-11-04T10:13:44.000Z thumbnails job=1a2b3c4d video=5e6f7a8b 3 thumbnails and a 100 frame sprite in 4.0s
2026-11-04T10:14:02.000Z upload job=1a2b3c4d video=5e6f7a8b 456 files, 610.2 MB in 18.0s
2026-11-04T10:14:02.300Z done job=1a2b3c4d video=5e6f7a8b ready in 711.3s
2026-11-04T10:15:10.800Z captions job=1a2b3c4d video=5e6f7a8b language=en cues=212 English (auto-generated) in 68.5s
```

Updates are logged in `/var/log/sloptube-encoder-update.log`.

Check that ffmpeg and whisper work on the box (encodes a 3 second test clip and
has whisper listen to 2 seconds of silence):

```bash
docker exec sloptube-encoder node --test test/
```

---

## What it makes

Everything for a video lives under `hls/<video id>/` in the bucket:

| File | What it is |
| --- | --- |
| `master.m3u8` | the HLS master playlist (`videos.hls_key`). Cached for a minute, not five, because HD and captions are added to it later. |
| `360p/`, `720p/`, `1080p/` | `index.m3u8`, an `init` segment and 4 second `.m4s` segments |
| `thumb-1.webp`, `thumb-2.webp`, `thumb-3.webp` | frames at 10%, 50% and 90%, 1280 wide. The first is the default. |
| `sprite.webp`, `sprite.vtt` | the hover preview: one 160x90 frame every 5 s (at most 100), and the WebVTT that maps time to tile (`videos.preview_sprite_key`) |
| `captions/<lang>.vtt`, `captions/<lang>.m3u8` | the auto-generated captions as WebVTT, and the HLS subtitle playlist that `master.m3u8` names. `<lang>` is the language the speech model heard, like `en`. Only when somebody speaks. |

- **Smart order** (migration 039). The quick lane makes every new upload's
  360p, thumbnails and sprite, one after the other, then hands the HD part
  back to the queue (`sd ... HD queued` in the log). The HD lane makes 720p and
  up with the faster `superfast` preset, one video at a time, at the lowest CPU
  priority (nice 19), followed by the captions. A 3 hour HD encode no longer
  holds up a new upload's 360p.
- **Low quality first.** An upload of 720p or more is made in two runs: the
  sizes below 720p, the thumbnails and the sprite first, so the video plays at
  360p within minutes, then 720p and up, added to the same `master.m3u8` when
  they are done (migration 038). Meanwhile the player's quality menu says "HD is
  still processing" and the studio says "HD processing, 64%". The source is
  read twice, which costs about a tenth more encoder time than one run. If only
  the HD run fails for good, the video stays up at low quality. Smaller uploads,
  and a database without 038, get one run as before. The log has an `sd` line
  when the low quality is playable:

  ```
  2026-11-04T10:05:20.000Z sd job=1a2b3c4d video=5e6f7a8b 360p playable in 189.2s, HD next
  ```
- **Never upscaled.** A 720p upload gets 360p and 720p. Something between two
  sizes (like 1600x900) also gets one at its own size. Portrait videos count
  their short side, so a 1080x1920 phone video is 1080p.
- **H.264 and AAC**, keyframes every 4 seconds, `veryfast` x264 preset.
- **fMP4 segments, not MPEG-TS.** They have less overhead, play in hls.js and in
  Safari, and the same files can be served as DASH later without encoding again.

Custom thumbnails from the studio (feature 12) land in the same folder as
`custom-<random>.jpg`, `.png` or `.webp`. The website writes those, not the encoder.

## Auto-generated captions

After a video is ready, so nobody waits for them, the worker writes its
captions with [whisper.cpp](https://github.com/ggml-org/whisper.cpp) and the
multilingual `base` model, both in the image:

1. ffmpeg cuts the sound into 15 minute pieces of 16 kHz mono WAV, one at a time,
   so memory and disk stay small even for a long video.
2. `whisper-cli` turns each piece into words with times. The Silero voice
   detection model skips music and silence, so a game soundtrack does not become
   made-up sentences. The first piece where somebody speaks sets the language;
   the rest of the video stays in it.
3. The words become a WebVTT file with at most 2 lines of about 42 characters
   per caption, and `master.m3u8` is uploaded again with an
   `EXT-X-MEDIA:TYPE=SUBTITLES` line ("English (auto-generated)", off by default)
   on every variant. Viewers turn them on with the CC button. The database does
   not change: the player finds them in the playlist.

How long it takes depends on the CPUs; the limit is the video's length (at
least 15 minutes, at most 6 hours), and the next upload waits until it is done. Captions never fail a video: when
whisper breaks, runs out of time or hears nobody, the video simply has none and
the log says why. At start the worker has whisper listen to 2 seconds of silence
and logs `captions ... on`, or `captions off: ...` with the reason (a CPU
without AVX2, for example). `CAPTIONS=off` turns them off.

The image builds whisper.cpp from a pinned release (`WHISPER_VERSION` in the
Dockerfile) and checks the speech model against the SHA-1 in whisper.cpp's
`models/README.md`.

## Channel bots

The worker also delivers the channel bots (`supabase/migrations/030_bots.sql`,
`034_bot_panel.sql` and `035_bots_at_once.sql`, `lib/bots.mjs`) beside the
encodes, with the same service role key and bucket: no new settings. Nothing
happens on its own: it only delivers what the owner of a channel with `bots_on`
(@typicalgamer) ordered in the studio's Bots page, while the `bots` flag is not
`off`. An "all at once" order gets its views, likes, dislikes and subscribers
from the database when it is placed; every 5 seconds the worker writes the
comments of running orders (about moments in the video, read from its captions
in the bucket, `hls/<video>/captions/`), up to 100 an order a round, and gives
orders spread over an hour, a day or a week their share so far. The bot account
pool grows when there are no bots left to comment. For a Premiere or live
broadcast the owner ticked, every 15 seconds while it is on it keeps a crowd
watching and posts a few chat lines (the rates are in the one row of
`public.bot_settings`). The log shows an `orders round done` line for each
round that added something.

## Scheduled videos

Once a minute, beside the encodes, the worker calls `publish_scheduled()`
(`supabase/migrations/042_upload_options.sql`, `lib/schedule.mjs`): videos
scheduled in the uploader or the studio whose time has come go public. One
still processing then goes public as soon as it is ready. No new settings. The
log shows a `scheduled videos went public` line when some did. Before 042 is
run it says so once and asks again every 10 minutes.

## Emptying the trash in R2

Videos deleted in the studio stay in the trash for 30 days. Then the daily
`purge_trash()` (migration 014, pg_cron) deletes the row and queues the video's
two folders, `hls/<video id>/` and `uploads/<owner id>/<video id>/`, in the
`storage_cleanup` table. Between encodes, every 10 minutes, the worker claims up
to 20 of them, deletes every object under each one and marks it `done` with the
count. A folder that fails is tried again later, up to 5 times; the reason is in
`storage_cleanup.error`. The worker only ever deletes under those two kinds of
prefix, and the table refuses anything else.

This needs the token's **Object Read & Write** permission, which also covers
deleting. Nothing to set up beyond migration 014.

## When something goes wrong

- A failed encode is tried again, up to 3 attempts. After that the video shows
  **Failed** in `/studio/videos` with the reason. The `encode_jobs` table in the
  [table editor](https://supabase.com/dashboard/project/_/editor)
  has the details.
- An upload whose size in R2 does not match what the browser said is refused
  right away, without retries.
- A long video is thousands of files (a 3 hour 1080p video is about 8,600), and
  R2 or S3 may answer "Please reduce your request rate." when they come fast.
  The worker sends 6 files at a time, and when the storage says to slow down,
  every upload pauses (half a second, doubling up to 30 seconds) and that file
  goes again, up to 10 tries. If a file is still refused, the files not sent yet
  go again a minute later, up to 3 rounds, before the job fails, so the encode
  is not thrown away. The log shows `storage still busy ... trying again in a
  minute` when that happens.
- The upload comes down from storage in 64 MB pieces, 4 at a time, and the bar
  moves through its first 10% as they arrive. A piece whose connection drops is
  fetched again on its own (up to 6 tries), so a slow or flaky bucket costs
  time, not the video.
- If the box crashes during an encode, the worker gives its jobs back when it
  starts again. A running job tells the database it is alive every minute
  (migration 037); one silent for 10 minutes is taken back by the next slot
  that asks, however long the encode has been going, so several slots and boxes
  never work on the same video. (Before 037, a job running for 2 h 15 min was
  taken back, which is still the rule for a worker without heartbeats.)
- To try a failed video again, the owner presses **Retry** on it in the studio
  or on its watch page (migration 033, the `retry_failed` flag, 3 times a day).
  Without the flag, set its `status` back to `uploaded` in the `videos` table.
  Either way a fresh job is queued with the file already uploaded.
- To stop the encoder: `systemctl stop sloptube-encoder`. A running job goes back
  in the queue.

## On Railway instead of a box

The worker also runs as a second Railway service next to the website, with a
Railway bucket instead of R2:

1. Add a service from this GitHub repository and set its **Root Directory** to
   `/worker`. Railway finds `worker/Dockerfile` (the same image as `Dockerfile` here).
2. Give it these variables. The bucket ones can reference the website service,
   for example `${{sloptube.S3_BUCKET}}`:
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `S3_ENDPOINT`, `S3_ACCESS_KEY_ID`,
   `S3_SECRET_ACCESS_KEY`, `S3_BUCKET`, `S3_REGION`, `S3_FORCE_PATH_STYLE`.
   With `S3_ENDPOINT` set the `R2_*` settings are not needed.
3. It needs no domain or port. One replica: two workers would just share the queue.
4. Every push to the branch it follows rebuilds it, which stops a running encode
   (the job goes back in the queue and starts again). Push worker changes while
   no video is processing.

## Files

- `Dockerfile`: the worker image (Node 22 and ffmpeg from Debian, and whisper.cpp
  with its models for the captions), built from `worker/`
- `../../worker/Dockerfile`: the same image for hosts that build from `worker/` itself (Railway)
- `docker-compose.yml`: the service, its work and state folders and log limits
- `install.sh`: the installer above
- `../../.github/workflows/encoder.yml`: tests the worker and builds the image on push to `release`
