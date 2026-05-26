export type Watchlist = {
  id: string;
  user_id: string;
  name: string;
  query: string;
  max_price: number | null;
  marketplace: string;
  country_filter: string;
  notes: string | null;
  active: boolean;
  last_scan_at: string | null;
  created_at: string;
};

export type SourcingItem = {
  id: string;
  watchlist_id: string;
  title: string;
  price: number;
  currency: string;
  shipping_price: number | null;
  url: string;
  image_url: string | null;
  seller_username: string | null;
  seller_feedback: number | null;
  country: string | null;
  condition: string | null;
  status: 'new' | 'watching' | 'ignored' | 'bought' | 'too_expensive';
  first_seen_at: string;
};
