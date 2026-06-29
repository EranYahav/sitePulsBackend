import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export type UploadResult = {
  publicId: string;
  url: string;
  resourceType: string;
};

export function uploadStream(
  buffer: Buffer,
  resourceType: "image" | "video" | "raw" | "auto",
  folder = "onePulse/report",
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: resourceType },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Upload failed"));
        resolve({
          publicId: result.public_id,
          url: result.secure_url,
          resourceType: result.resource_type,
        });
      },
    );
    stream.end(buffer);
  });
}

export function deleteAsset(publicId: string, resourceType: "image" | "video" | "raw") {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
}

// Delete every asset under a folder prefix (e.g. onePulse/{ownerId}/{projectId}/imageBank),
// then remove the now-empty folder. Cloudinary scopes deletes per resource_type and
// `delete_resources_by_prefix` handles up to 1000 per call, so we loop on next_cursor for
// each of image+video. delete_folder is eventually-consistent after a prefix delete and
// throws if the folder still looks non-empty — we tolerate that. Returns the public_ids
// that FAILED to delete so the caller can record them (orphaned billable assets otherwise
// have no DB trace). NOTE: this is new code with no prior art in the repo (reports.ts only
// does single-asset destroy) — verify against the live Cloudinary account before relying on it.
export async function deleteByPrefix(
  prefix: string,
): Promise<{ deleted: number; failed: string[] }> {
  let deleted = 0;
  const failed: string[] = [];

  for (const resourceType of ["image", "video"] as const) {
    let nextCursor: string | undefined;
    do {
      try {
        const res: { deleted?: Record<string, string>; next_cursor?: string } =
          await cloudinary.api.delete_resources_by_prefix(prefix, {
            resource_type: resourceType,
            ...(nextCursor ? { next_cursor: nextCursor } : {}),
          });
        const outcomes = res.deleted ?? {};
        for (const [publicId, status] of Object.entries(outcomes)) {
          if (status === "deleted") deleted++;
          else failed.push(publicId);
        }
        nextCursor = res.next_cursor;
      } catch {
        // A transient API error here would otherwise leave assets billable with no trace;
        // record the prefix+resourceType so the caller logs it, and stop this type's loop.
        failed.push(`${prefix}/* (${resourceType} page failed)`);
        nextCursor = undefined;
      }
    } while (nextCursor);
  }

  // Best-effort folder removal. Often throws "folder not empty" right after a prefix delete
  // (eventual consistency) — that's expected and not an error worth surfacing.
  try {
    await cloudinary.api.delete_folder(prefix);
  } catch {
    /* folder still settling or already gone — ignore */
  }

  return { deleted, failed };
}

// Signed delivery URL for the public client portal. The signature is tied to our
// API secret so the URL can't be tampered with. The authoritative revocation
// check happens in the portal image proxy on EVERY request (see routes/portal.ts) —
// the rendered portal never embeds a raw Cloudinary URL, only proxy URLs, so
// revoking a ShareLink cuts off image access at the proxy.
export function signedImageUrl(publicId: string): string {
  return cloudinary.url(publicId, { secure: true, sign_url: true, resource_type: "image" });
}
