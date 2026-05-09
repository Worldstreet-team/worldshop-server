import { z } from 'zod';

export const attachDigitalAssetsSchema = z.object({
  files: z
    .array(
      z.object({
        key: z.string().min(1),
        r2Key: z.string().min(1).optional(),
        fileName: z.string().optional(),
        mimeType: z.string().optional(),
        fileSize: z.number().int().min(0).optional(),
        size: z.number().int().min(0).optional(),
      }),
    )
    .min(1),
});

export type AttachDigitalAssetsInput = z.infer<typeof attachDigitalAssetsSchema>;
