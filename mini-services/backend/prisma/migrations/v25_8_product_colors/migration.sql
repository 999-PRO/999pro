-- v25.8 (TRI999 launch): Product colors with per-color image.
-- Adds a `colors` column to the Product table storing a JSON-encoded array
-- of { name, image } objects. Empty array means no color variants.
ALTER TABLE "Product" ADD COLUMN "colors" TEXT NOT NULL DEFAULT '[]';
