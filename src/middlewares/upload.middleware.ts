import multer, { MulterError } from 'multer';
import { Request, Response, NextFunction } from 'express';

/**
 * Multer configuration for memory storage (no disk writes).
 * Files are kept in memory buffers for direct upload to R2.
 */
const storage = multer.memoryStorage();

// ─── Image uploads ──────────────────────────────────────────────

const imageFileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: JPEG, PNG, WebP, GIF, SVG`));
  }
};

const imageUpload = multer({
  storage,
  fileFilter: imageFileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB per file
    files: 10, // Max 10 files at once
  },
});

// ─── Digital file uploads ───────────────────────────────────────

const digitalFileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedMimes = [
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'text/csv',
    // Archives
    'application/zip',
    'application/x-rar-compressed',
    'application/gzip',
    // E-books
    'application/epub+zip',
  ];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type: ${file.mimetype}. Allowed: PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, CSV, ZIP, RAR, GZIP, EPUB`));
  }
};

const digitalUpload = multer({
  storage,
  fileFilter: digitalFileFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB per file
    files: 10, // Max 10 files at once
  },
});

/**
 * uploadProductImages — Multer middleware for product image uploads.
 * Accepts up to 10 files on the "images" field.
 */
export const uploadProductImages = imageUpload.array('images', 10);

/**
 * uploadCategoryImage — Multer middleware for a single category image.
 */
export const uploadCategoryImage = imageUpload.single('image');

/**
 * uploadDigitalFiles — Multer middleware for digital product file uploads.
 * Accepts up to 10 files on the "files" field. Max 100MB per file.
 */
export const uploadDigitalFiles = digitalUpload.array('files', 10);

/**
 * handleMulterError — Error handler for multer-specific errors.
 */
export function handleMulterError(err: Error, _req: Request, res: Response, next: NextFunction): void {
  if (err instanceof MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      res.status(400).json({ success: false, message: 'File too large. Maximum size is 100MB for digital files or 5MB for images.' });
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
