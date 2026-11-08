// S3-compatible object storage. Only server routes import this file, and the
// tests load it directly with a mocked client.

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { UploadStorage } from "./handlers.ts";
import type { StorageConfig } from "./env.ts";

/** An S3 client pointed at the configured object-storage endpoint. */
export function createS3Client(config: StorageConfig): S3Client {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    forcePathStyle: config.forcePathStyle,
    // Newer SDKs add checksum headers to every request by default. Presigned
    // part URLs must not expect them, because the browser does not send them.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/** UploadStorage on top of an S3 client and one bucket. */
export function createS3Storage(client: S3Client, bucket: string): UploadStorage {
  return {
    async createMultipart(key, mime) {
      const out = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: mime }));
      if (!out.UploadId) throw new Error("Object storage did not return an upload id");
      return out.UploadId;
    },

    presignPart(key, uploadId, partNumber, expiresIn) {
      return getSignedUrl(
        client,
        new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
        { expiresIn },
      );
    },

    async completeMultipart(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
          MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
        }),
      );
    },

    async abortMultipart(key, uploadId) {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    },

    async objectSize(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return typeof out.ContentLength === "number" ? out.ContentLength : null;
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
        throw err;
      }
    },

    presignThumbnail(key, mime) {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: mime, CacheControl: "public, max-age=300" }),
        { expiresIn: 10 * 60 },
      );
    },

    async thumbnailInfo(key) {
      try {
        const out = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return {
          bytes: Number(out.ContentLength ?? 0),
          type: out.ContentType ?? null,
        };
      } catch (err) {
        const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
        if (status === 404 || (err as { name?: string }).name === "NotFound") return null;
        throw err;
      }
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })).catch(() => {});
    },
  };
}
