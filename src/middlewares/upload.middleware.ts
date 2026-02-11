import multer, { MulterError } from 'multer';
import { Request, Response, NextFunction } from 'express';

/**
 * Multer configuration for memory storage (no disk writes).
 * Files are kept in memory buffers for direct upload to R2.
 */
const storage = multer.memoryStorage();

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, GIF, SVG`));
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 10, // Max 10 files at once
  },
});

/**
 * uploadProductImages — Multer middleware for product image uploads.
 * Accepts up to 10 files on the "images" field.
 */
export const uploadProductImages = upload.array('images', 10);

/**
 * uploadCategoryImage — Multer middleware for a single category image.
 */
export const uploadCategoryImage = upload.single('image');

/**
 * handleMulterError — Error handler for multer-specific errors.
 */
export function handleMulterError(err: Error, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, message: 'File too large. Maximum size is 5MB.' });
      return;
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      res.status(400).json({ success: false, message: 'Too many files. Maximum is 10.' });
      return;
    }
    res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    return;
  }

  if (err.message.startsWith('Invalid file type')) {
    res.status(400).json({ success: false, message: err.message });
    return;
  }

  next(err);
}
