import { z } from "zod";
import { BUYING_OPTIONS, GRADING_OPTIONS, TRACK_STATUSES } from "../db/schema.js";
import { MARKETPLACES, VINTED } from "../ebay/marketplaces.js";

const word = z.string().trim().toLowerCase().min(1).max(40);

/** Champs sans valeur par défaut : avec Zod 4, un défaut s'appliquerait même dans un schéma partiel. */
const fields = {
  query: z.string().trim().min(1, "Mots-clés requis").max(300),
  maxPrice: z.number().positive().nullable(),
  buying: z.enum(BUYING_OPTIONS),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Code pays sur 2 lettres")
    .nullable(),
  excludes: z.array(word).max(50),
  requiredWords: z.array(word).max(20),
  grading: z.enum(GRADING_OPTIONS),
  excludeLots: z.boolean(),
  minSellerFeedbackPct: z.number().min(0).max(100).nullable(),
  minSellerFeedbackScore: z.number().int().min(0).nullable(),
  endingWindowMin: z.number().int().min(5).max(1440),
  marketplaces: z
    .array(z.string().refine((m) => m === VINTED || MARKETPLACES.includes(m), "Site inconnu"))
    .min(1, "Au moins un site")
    .transform((list) => [...new Set(list)])
    .refine((list) => !list.includes(VINTED) || list.length === 1, "Vinted ne se combine pas avec eBay"),
};

export const SearchInputSchema = z.object({
  ...fields,
  maxPrice: fields.maxPrice.default(null),
  buying: fields.buying.default("ALL"),
  country: fields.country.default(null),
  excludes: fields.excludes.default([]),
  requiredWords: fields.requiredWords.default([]),
  grading: fields.grading.default("ANY"),
  excludeLots: fields.excludeLots.default(false),
  minSellerFeedbackPct: fields.minSellerFeedbackPct.default(null),
  minSellerFeedbackScore: fields.minSellerFeedbackScore.default(null),
  endingWindowMin: fields.endingWindowMin.default(60),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

/** Modification : seuls les champs envoyés changent. */
export const SearchPatchSchema = z.object(fields).partial().extend({ active: z.boolean().optional() });

export const PreviewSchema = SearchInputSchema.omit({ endingWindowMin: true });

export const ItemPatchSchema = z
  .object({
    status: z.enum(TRACK_STATUSES).nullable(),
    maxBid: z.number().positive().nullable(),
    note: z.string().trim().max(500).nullable(),
  })
  .partial();

export const SettingsSchema = z
  .object({
    importVatRate: z.number().min(0).max(1),
    customsFee: z.number().min(0).max(500),
    reminderMinutes: z.number().int().min(1).max(240),
  })
  .partial();

export const VintedPushSchema = z.object({
  searchId: z.number().int(),
  items: z
    .array(
      z.object({
        externalId: z.string().min(1).max(40),
        title: z.string().min(1).max(300),
        price: z.number().min(0),
        url: z.string().min(1).max(500),
        imageUrl: z.string().max(500).nullish(),
        condition: z.string().max(100).nullish(),
      }),
    )
    .max(200),
});
