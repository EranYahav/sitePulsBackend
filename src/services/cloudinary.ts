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

// Signed delivery URL for the public client portal. The signature is tied to our
// API secret so the URL can't be tampered with. The authoritative revocation
// check happens in the portal image proxy on EVERY request (see routes/portal.ts) —
// the rendered portal never embeds a raw Cloudinary URL, only proxy URLs, so
// revoking a ShareLink cuts off image access at the proxy.
export function signedImageUrl(publicId: string): string {
  return cloudinary.url(publicId, { secure: true, sign_url: true, resource_type: "image" });
}
