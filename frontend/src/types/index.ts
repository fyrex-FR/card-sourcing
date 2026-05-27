export type Watchlist = {
  id: string;
  user_id: string;
  name: string;
  query: string;
  max_price: number | null;
  marketplace: string;
  country_filter: string;
  buying_option: 'ALL' | 'AUCTION' | 'FIXED_PRICE';
  notes: string | null;
  active: boolean;
  last_scan_at: string | null;
  created_at: string;
};

export type SourcingItem = {
  id: string;
  watchlist_id: string;
  external_id?: string | null;
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
  buying_options: string[] | null;
  auction_end_at: string | null;
  bid_count: number | null;
  match_query: string | null;
  match_quality: 'exact' | 'partial' | null;
  status: 'new' | 'watching' | 'bid_planned' | 'ignored' | 'bought' | 'too_expensive';
  max_bid: number | null;
  note: string | null;
  first_seen_at: string;
};

export type SellerFavorite = {
  user_id: string;
  seller_username: string;
  note: string | null;
  created_at: string;
};

export type ScanResult = {
  count: number;
  scanned_count?: number;
  candidate_count?: number;
  error?: string;
  details?: string;
  items?: SourcingItem[];
};

export type SellerAuctionResult = {
  count: number;
  total?: number;
  seller_username: string;
  query: string;
  days: number;
  results: SourcingItem[];
  error?: string;
  details?: string;
};
