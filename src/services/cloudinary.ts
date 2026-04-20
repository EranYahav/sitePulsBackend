import { v2 as cloudinary } from "cloudinary";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const FOLDER = "onePulse/report";

export type UploadResult = {
  publicId: string;
  url: string;
  resourceType: string;
};

export function uploadStream(
  buffer: Buffer,
  resourceType: "image" | "video" | "raw" | "auto",
): Promise<UploadResult> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder: FOLDER, resource_type: resourceType },
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
