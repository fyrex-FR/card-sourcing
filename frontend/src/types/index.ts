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
  status: 'new' | 'watching' | 'in_basket' | 'bid_planned' | 'ignored' | 'bought' | 'too_expensive';
  max_bid: number | null;
  note: string | null;
  notify_enabled: boolean | null;
  notify_minutes_before: number | null;
  notify_minutes_before_secondary: number | null;
  first_seen_at: string;
};

export type SellerFavorite = {
  user_id: string;
  seller_username: string;
  note: string | null;
  shipping_estimate: number | null;
  created_at: string;
};

export type UserSettings = {
  discord_webhook_url: string | null;
  notify_minutes_before: number | null;
  notify_minutes_before_secondary: number | null;
  notify_bid_planned: boolean | null;
  notify_in_basket: boolean | null;
  notify_watching: boolean | null;
  discord_mention_here: boolean | null;
  discord_mention_at_minutes: number | null;
  daily_summary_enabled: boolean | null;
  daily_summary_hour: number | null;
  notify_max_bid_exceeded: boolean | null;
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

export type ClutchDeal = {
  source: 'clutchcollect';
  source_id: string;
  sale_type: 'auction' | 'listing' | string;
  title: string;
  player: string;
  team: string;
  year: string;
  manufacturer: string;
  program: string;
  set_name: string;
  card_number: string;
  serial_number: string;
  sequence_number: string;
  grade: string;
  price: number | null;
  currency: string;
  seller: string;
  ends_at: string;
  total_bids: number | null;
  image_url: string;
  clutch_url: string;
  comp_query: string;
  ebay_sold_url: string;
  one30point_url: string;
  score: number;
  reasons: string[];
};

export type ClutchEnrichment = {
  player: string;
  team: string;
  year: string;
  manufacturer: string;
  set_name: string;
  insert_name: string;
  parallel_name: string;
  parallel_confidence: number;
  card_number: string;
  numbered: string;
  serial: string;
  is_rookie: boolean;
  is_autograph: boolean;
  is_patch: boolean;
  card_type: string;
  search_query: string;
  confidence: number;
  ebay_sold_url: string;
  one30point_url: string;
  latency_ms: number;
};

export type ClutchDealsResult = {
  count: number;
  stats: {
    totalSales?: number;
    totalResults?: number;
    totalListings?: number;
    totalAuctions?: number;
    currentPage?: number;
    totalPages?: number;
  };
  results: ClutchDeal[];
};
