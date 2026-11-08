import { publishUpload } from "@/lib/upload/handlers";
import { runUploadRoute } from "@/lib/upload/context";

export async function POST(request: Request) {
  return runUploadRoute(request, publishUpload);
}
