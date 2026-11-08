import "server-only";

/** Server-only object storage settings. Never prefix these with NEXT_PUBLIC. */
export const S3_ENV = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_FORCE_PATH_STYLE",
] as const;

export type StorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
};

/**
 * Reads storage settings at request time, like lib/supabase/env.ts, so one
 * Docker image works with whatever is in /opt/sloptube/.env.
 * S3 settings take precedence; the legacy R2 settings remain supported.
 */
export function readStorageConfig(): StorageConfig | null {
  const env = process.env;
  const s3Values = S3_ENV.map((name) => env[name]?.trim() ?? "");
  if (s3Values.some(Boolean)) {
    const [endpoint, region, accessKeyId, secretAccessKey, bucket, forcePathStyle] = s3Values;
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) return null;
    let parsedEndpoint: URL;
    try {
      parsedEndpoint = new URL(endpoint);
    } catch {
      return null;
    }
    if (
      parsedEndpoint.protocol !== "https:" ||
      parsedEndpoint.username ||
      parsedEndpoint.password ||
      parsedEndpoint.search ||
      parsedEndpoint.hash
    ) return null;
    if (forcePathStyle && forcePathStyle !== "true" && forcePathStyle !== "false") return null;
    return {
      endpoint: parsedEndpoint.origin + parsedEndpoint.pathname.replace(/\/+$/, ""),
      region: region || "auto",
      accessKeyId,
      secretAccessKey,
      bucket,
      forcePathStyle: forcePathStyle === "true",
    };
  }

  const [accountId, accessKeyId, secretAccessKey, bucket] = [
    env.R2_ACCOUNT_ID,
    env.R2_ACCESS_KEY_ID,
    env.R2_SECRET_ACCESS_KEY,
    env.R2_BUCKET,
  ].map((value) => value?.trim() ?? "");
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;
  return {
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    region: "auto",
    accessKeyId,
    secretAccessKey,
    bucket,
    forcePathStyle: true,
  };
}
