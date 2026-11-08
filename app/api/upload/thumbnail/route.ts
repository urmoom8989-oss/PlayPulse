import { originOf } from "@/lib/studio/http";
import { finishUploadThumbnail } from "@/lib/upload/handlers";
import { uploadContext } from "@/lib/upload/context";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const result = await finishUploadThumbnail(body, await uploadContext(), originOf(request));
  return Response.json(result.body, { status: result.status, headers: { "Cache-Control": "no-store" } });
}
