import { z } from 'zod';

export const availabilityStatusSchema = z.enum(['in_stock', 'low_stock', 'out_of_stock', 'preorder', 'unknown']);
export const productStatusSchema = z.enum(['active', 'inactive', 'draft']);

export const productCreateSchema = z.object({
  sku: z.string().min(1),
  title: z.string().min(1),
  summary: z.string().min(1),
  brand: z.string().min(1),
  category: z.string().min(1),
  product_url: z.string().url().optional(),
  image_urls: z.array(z.string().url()).default([]),
  currency: z.string().regex(/^[A-Z]{3}$/).default('USD'),
  amount: z.number().nonnegative(),
  availability_status: availabilityStatusSchema.default('in_stock'),
  quantity: z.number().int().min(0).default(0),
  status: productStatusSchema.default('active'),
  attributes: z.record(z.string(), z.unknown()).default({}),
});

export const productPatchSchema = productCreateSchema.partial().refine((value) => Object.keys(value).length > 0, {
  message: 'At least one field is required',
});

export const syncRequestSchema = z.object({
  registration_version: z.number().int().min(1).optional(),
});

export type ProductCreateInput = z.infer<typeof productCreateSchema>;
export type ProductPatchInput = z.infer<typeof productPatchSchema>;
