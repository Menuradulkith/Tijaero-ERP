export interface Category {
  id: number;
  name: string;
  category_code: string;
  memo?: string;
  description?: string;
  active: boolean;
  created_date: string;
  created_at: string;
  updated_at: string;
}

export interface CategoryCreate {
  name: string;
  category_code: string;
  memo?: string;
  description?: string;
  active?: boolean;
}

export interface Brand {
  id: number;
  brand_name: string;
  brand_code: string;
  description?: string;
}

export interface BrandCreate {
  brand_name: string;
  brand_code: string;
  description?: string;
}

export interface Product {
  id: number;
  name: string;
  item_code: string;
  model?: string;
  item_type: string;
  description?: string;
  website_active: boolean;
  website_price?: number;
  active: boolean;
  cost_price: number;
  category_id: number;
  items_brand_id: number;
  created_date: string;
  added_date: string;
  created_at: string;
  updated_at: string;
}

export interface ProductCreate {
  name: string;
  item_code: string;
  model?: string;
  item_type: string;
  description?: string;
  website_active?: boolean;
  website_price?: number;
  active?: boolean;
  cost_price: number;
  category_id: number;
  items_brand_id: number;
}

export interface ProductUpdate {
  name?: string;
  model?: string;
  item_type?: string;
  description?: string;
  website_active?: boolean;
  website_price?: number;
  active?: boolean;
  cost_price?: number;
  category_id?: number;
  items_brand_id?: number;
}
