import { z } from "zod";
import { BUYING_OPTIONS } from "../db/schema.js";
import { MARKETPLACES } from "../ebay/marketplaces.js";

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
  endingWindowMin: z.number().int().min(5).max(1440),
  marketplaces: z
    .array(z.string().refine((m) => MARKETPLACES.includes(m), "Site eBay inconnu"))
    .min(1, "Au moins un site eBay")
    .transform((list) => [...new Set(list)]),
};

export const SearchInputSchema = z.object({
  ...fields,
  maxPrice: fields.maxPrice.default(null),
  buying: fields.buying.default("ALL"),
  country: fields.country.default(null),
  excludes: fields.excludes.default([]),
  endingWindowMin: fields.endingWindowMin.default(60),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

/** Modification : seuls les champs envoyés changent. */
export const SearchPatchSchema = z.object(fields).partial().extend({ active: z.boolean().optional() });

export const PreviewSchema = SearchInputSchema.pick({
  query: true,
  maxPrice: true,
  buying: true,
  country: true,
  excludes: true,
  marketplaces: true,
});
