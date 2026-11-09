#!/usr/bin/env node
// sloptube encoder worker.
//
// Polls claim_encode_job every 5 seconds with the Supabase service role key,
// downloads the source from R2, encodes it to HLS (360p, 720p, 1080p as the
// source allows), makes thumbnails and the hover preview sprite, uploads it
// all to R2 under hls/<video>/ and calls encode_done. Then it writes the
// video's auto-generated captions with whisper.cpp. One job at a time.
// Between jobs it empties the R2 folders of videos the studio trash purged.
// Beside all that, the channel bots run (lib/bots.mjs, the bots flag).
//
// Settings come from the environment, see lib/env.mjs and ops/encoder/README.md.
//   node index.mjs
import { createBotDb, runBots } from "./lib/bots.mjs";
import { checkCaptions } from "./lib/captions.mjs";
import { createDb, createSupabase } from "./lib/db.mjs";
import { readConfig } from "./lib/env.mjs";
import { createLogger } from "./lib/log.mjs";
import { runLoop, sleep } from "./lib/loop.mjs";
import { run } from "./lib/run.mjs";
import { createR2Client, createStorage } from "./lib/storage.mjs";

const log = createLogger();
const config = readConfig();

if (config.missing.length) {
  log("config", {}, `missing settings: ${config.missing.join(", ")}. Add them to the env file and restart.`);
  // Wait a little so a restarting container does not spin.
  await sleep(30000);
  process.exit(1);
}

try {
  const version = (await run("ffmpeg", ["-hide_banner", "-version"])).split("\n")[0];
  log("ffmpeg", {}, version);
} catch (err) {
  log("ffmpeg", {}, `ffmpeg is not installed or does not run: ${err.message}`);
  process.exit(1);
}

// Auto-generated captions only when whisper.cpp and its model are there.
config.captions = await checkCaptions(config.captions, { log, run, workDir: config.workDir });

const stop = new AbortController();
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.once(sig, () => {
    log("signal", { signal: sig }, "stopping after the current step");
    stop.abort();
  });
}

const supabase = createSupabase(config.supabaseUrl, config.serviceRoleKey);
const storage = createStorage(createR2Client(config.r2), config.bucket);
await Promise.all([
  runLoop({ db: createDb(supabase), storage, log, config, stopSignal: stop.signal }),
  runBots({ db: createBotDb(supabase), storage, log, stopSignal: stop.signal }),
]);
process.exit(0);
