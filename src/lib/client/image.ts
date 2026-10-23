/** Downscale a user photo to a JPEG data payload small enough to send for analysis. */
export async function downscaleImage(file: File, maxEdge = 1024, quality = 0.82): Promise<{ base64: string; mediaType: "image/jpeg"; preview: string }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { base64: dataUrl.split(",")[1] ?? "", mediaType: "image/jpeg", preview: dataUrl };
}
