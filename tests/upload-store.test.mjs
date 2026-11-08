import assert from "node:assert/strict";
import { test } from "node:test";
import { useUpload } from "../lib/store/upload.ts";

test("selecting a video and thumbnail makes a draft without network requests; Publish surfaces quota errors", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        error: "daily_limit",
        message: "You can upload 10 videos a day. Try again tomorrow.",
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    );
  };

  try {
    useUpload.getState().reset();
    useUpload.getState().pick(new File(["video"], "draft.mp4", { type: "video/mp4" }));
    useUpload.getState().setThumbnailFile(new File(["image"], "thumb.jpg", { type: "image/jpeg" }));
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(useUpload.getState().phase, "draft");
    assert.equal(useUpload.getState().fileName, "draft.mp4");
    assert.equal(requests.length, 0, "selection and thumbnail preview must not start any request");

    await useUpload.getState().startUpload();
    assert.equal(requests.length, 0, "the upload action is unavailable before the visibility step");
    useUpload.getState().goToStep(1);
    useUpload.getState().goToStep(2);
    await useUpload.getState().startUpload();
    assert.deepEqual(requests.map((request) => request.url), ["/api/upload/sign"]);
    assert.equal(useUpload.getState().phase, "failed");
    assert.equal(useUpload.getState().error, "You can upload 10 videos a day. Try again tomorrow.");
  } finally {
    useUpload.getState().reset();
    globalThis.fetch = originalFetch;
  }
});

test("choosing Public uploads, completes, then publishes only after the final action", async () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  const requests = [];
  const uploadedParts = [];
  const videoId = "aaaaaaaa-bbbb-cccc-dddd-000000000001";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    if (url === "/api/upload/sign") {
      return Response.json({
        videoId,
        uploadId: "upload-1",
        parts: [{ partNumber: 1, url: "https://storage.example/part/1" }],
      });
    }
    if (url === "/api/upload/complete") {
      return Response.json({ watchUrl: `/watch?v=${videoId}` });
    }
    if (url === "/api/upload/publish") return Response.json({ videoId, visibility: "public" });
    throw new Error(`Unexpected request: ${url}`);
  };

  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 200;
    open(_method, url) {
      this.url = url;
    }
    getResponseHeader(name) {
      return name === "ETag" ? '"etag-1"' : null;
    }
    send(body) {
      uploadedParts.push(this.url);
      this.upload.onprogress?.({ loaded: body.size });
      this.onload?.();
    }
    abort() {
      this.onabort?.();
    }
  };

  try {
    useUpload.getState().reset();
    useUpload.getState().pick(new File(["video"], "publish-me.mp4", { type: "video/mp4" }));
    useUpload.getState().setDetails({ title: "Publish me", category: "Music", visibility: "public" });
    useUpload.getState().goToStep(2);
    await new Promise((resolve) => setImmediate(resolve));

    assert.equal(useUpload.getState().phase, "draft");
    await useUpload.getState().startUpload();

    assert.deepEqual(requests.map((request) => request.url), [
      "/api/upload/sign",
      "/api/upload/complete",
      "/api/upload/publish",
    ]);
    assert.deepEqual(uploadedParts, ["https://storage.example/part/1"]);
    assert.equal(JSON.parse(requests[1].init.body).title, "Publish me");
    assert.equal(JSON.parse(requests[1].init.body).category, "Music");
    assert.equal(useUpload.getState().phase, "done");
    assert.equal(useUpload.getState().file, null);
    assert.equal(useUpload.getState().videoId, videoId);
    assert.equal(useUpload.getState().published, true);
  } finally {
    useUpload.getState().reset();
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXhr;
  }
});

test("the default Private visibility completes an upload without auto-publishing it", async () => {
  const originalFetch = globalThis.fetch;
  const originalXhr = globalThis.XMLHttpRequest;
  const requests = [];
  const videoId = "aaaaaaaa-bbbb-cccc-dddd-000000000002";
  globalThis.fetch = async (input) => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/upload/sign") {
      return Response.json({
        videoId,
        uploadId: "upload-2",
        parts: [{ partNumber: 1, url: "https://storage.example/part/1" }],
      });
    }
    if (url === "/api/upload/complete") return Response.json({ watchUrl: `/watch?v=${videoId}` });
    throw new Error(`Unexpected request: ${url}`);
  };
  globalThis.XMLHttpRequest = class {
    upload = {};
    status = 200;
    open() {}
    getResponseHeader(name) {
      return name === "ETag" ? '"etag-1"' : null;
    }
    send() {
      this.onload?.();
    }
    abort() {
      this.onabort?.();
    }
  };

  try {
    useUpload.getState().reset();
    useUpload.getState().pick(new File(["video"], "keep-private.mp4", { type: "video/mp4" }));
    useUpload.getState().goToStep(2);
    await useUpload.getState().startUpload();

    assert.deepEqual(requests, ["/api/upload/sign", "/api/upload/complete"]);
    assert.equal(useUpload.getState().phase, "done");
    assert.equal(useUpload.getState().details.visibility, "private");
    assert.equal(useUpload.getState().published, false);
  } finally {
    useUpload.getState().reset();
    globalThis.fetch = originalFetch;
    globalThis.XMLHttpRequest = originalXhr;
  }
});
