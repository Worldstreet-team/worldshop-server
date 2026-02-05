// import { createSlug, generateUniqueSlug } from '@/utils/productUtils';
import { model, Schema, Document, Types } from 'mongoose';

// Types and Interfaces
export type StatusReport = 'pending' | 'resolved';

export interface IProductVariant {
  attributes?: Record<string, string>;
  price?: number;
  itemsInStock?: number;
}

export interface IProduct extends Document {
  _id: Types.ObjectId;
  name: string;
  slug: string;
  basePrice: number;
  discountPrice: number;
  details: string;
  _vendor: Types.ObjectId;
  auctionPrice: number;
  images: string[];
  categories: string[];
  offers: string[];
  itemsInStock: number;
  isApproved: boolean;
  variants?: IProductVariant[];
}

export interface IProductReport extends Document {
  _id: Types.ObjectId;
  _customerId: Types.ObjectId;
  _productId: Types.ObjectId;
  message: string;
  status: StatusReport;
}

// Schemas
const productVariantSchema = {
  attributes: {
    type: Map,
    of: String,
  },
  price: {
    type: Number,
    validate: {
      validator: (value: number) => value >= 0,
      message: 'Price must be positive',
    },
  },
  itemsInStock: {
    type: Number,
    validate: {
      validator: (value: number) => Number.isInteger(value) && value >= 0,
      message: 'Items in stock must be a positive integer',
    },
  },
};

const productSchema = new Schema<IProduct>(
  {
    name: {
      type: String,
      required: [true, 'Product name is required'],
    },
    slug: {
      type: String,
      unique: true,
    },
    basePrice: {
      type: Number,
      required: [true, 'Product price is required'],
      validate: {
        validator: (value: number) => value >= 0,
        message: 'Price must be positive',
      },
    },
    discountPrice: {
      type: Number,
      index: true,
      validate: {
        validator: (value: number) => value >= 0,
        message: 'Discount Price must be a positive number',
      },
    },
    auctionPrice: {
      type: Number,
      required: [true, 'There must be an auction price'],
      validate: {
        validator: (value: number) => value >= 0,
        message: 'Value must be a positive number',
      },
    },
    details: {
      type: String,
      trim: true,
    },
    images: {
      type: [String],
      required: [true, 'At least one product image is required'],
      validate: {
        validator: (images: string[]) => images.length > 0,
        message: 'At least one product image is needed',
      },
    },
    categories: {
      type: [String],
      required: [true, 'At least one category is required'],
      validate: {
        validator: (categories: string[]) => categories.length > 0,
        message: 'At least one category is needed',
      },
    },
    offers: {
      type: [String],
      index: true,
    },
    itemsInStock: {
      type: Number,
      validate: {
        validator: (value: number) => Number.isInteger(value),
        message: 'Items in stock must be integer values',
      },
    },
    isApproved: {
      type: Boolean,
      default: false,
    },
    _vendor: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    variants: {
      type: [productVariantSchema],
    },
  },
  {
    timestamps: true,
  },
);

const productReportSchema = new Schema<IProductReport>(
  {
    _customerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    _productId: {
      type: Schema.Types.ObjectId,
      ref: 'Product',
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'resolved'] as StatusReport[],
      default: 'pending',
    },
  },
  {
    timestamps: true,
  },
);

// Indexes
productSchema.index(
  {
    name: 'text',
    details: 'text',
    categories: 'text',
  },
  {
    weights: {
      name: 10,
      categories: 5,
      details: 3,
    },
    name: 'product_text_search',
  },
);

// Factory functions for creating new instances
export const createProduct = (data: Partial<IProduct>) => {
  return new Product(data);
};

export const createProductReport = (data: Partial<IProductReport>) => {
  return new ProductReport(data);
};

// Models
export const Product = model<IProduct>('Product', productSchema);
export const ProductReport = model<IProductReport>(
  'ProductReport',
  productReportSchema,
);
