-- v25.10 (Task #6): Add vertical (3:4) product video fields.
-- videoUrl — relative path (/uploads/...) to the FFmpeg-compressed MP4.
-- videoPoster — relative path to the extracted first-frame JPEG.
-- Both nullable: existing products keep image-only galleries.

ALTER TABLE "Product" ADD COLUMN "videoUrl" VARCHAR(2048);
ALTER TABLE "Product" ADD COLUMN "videoPoster" VARCHAR(2048);
