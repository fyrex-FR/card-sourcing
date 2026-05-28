/**
 * Extracteur de mots-cles depuis un titre eBay de carte NBA.
 *
 * Probleme : un titre comme
 *   "1997-98 Score Board SB Tim Duncan PSA Promos Red Foil Auto Autograph CNG 9/10"
 * copie tel quel dans une recherche eBay sold ou 130point ramene tres peu de
 * resultats (titre trop specifique, mots filler qui penalisent le match).
 *
 * On extrait :
 *   - annee   : 1997-98, 2024, 2022-23, etc.
 *   - joueur  : suite de 2 mots capitalises post-annee, hors mots de bruit
 *   - marque  : Panini, Topps, Upper Deck, Score Board, etc.
 *   - flags   : auto / rookie / numbered (/10, /49 ...)
 *
 * Puis on construit 2 niveaux de requete :
 *   - "broad"   : player + year (max recall, peu de bruit)
 *   - "precise" : player + year + brand + auto + /num (recall + precision)
 */

const NOISE_WORDS = new Set([
  // bruit generique eBay
  'card', 'cards', 'nba', 'basketball', 'trading', 'sealed', 'lot', 'free',
  'shipping', 'official', 'authentic', 'rare', 'true', 'beautiful', 'mint',
  // grading
  'psa', 'bgs', 'sgc', 'cgc', 'gem', 'mt', 'nm', 'ex', 'ungraded', 'graded',
  // termes materiel/insert genericisant trop la recherche
  'patch', 'jersey', 'memorabilia', 'game', 'worn', 'box', 'office',
  'red', 'blue', 'green', 'gold', 'silver', 'orange', 'purple', 'black', 'white',
  // mots techniques
  'foil', 'refractor', 'parallel', 'insert', 'promo', 'promos',
  // equipes (simplification : on les retire pour eviter de doubler le contexte)
  'spurs', 'lakers', 'bulls', 'warriors', 'celtics', 'heat', 'rockets', 'nets',
  'knicks', 'sixers', 'mavs', 'mavericks', 'thunder', 'okc', 'wolves',
  'timberwolves', 'pacers', 'hawks', 'magic', 'pistons', 'kings', 'jazz',
  'nuggets', 'clippers', 'suns', 'blazers', 'grizzlies', 'hornets', 'wizards',
  'raptors', 'bucks', 'cavs', 'cavaliers',
  // chiffres seuls et lettres isolees
  'sb', 'sp', 'rc', 'cng', 'hof',
]);

// Marques / sets connus. Ordre: les plus longues d'abord (greedy match).
const KNOWN_BRANDS = [
  'Upper Deck',
  'Stadium Club',
  'Score Board',
  'Panini Noir',
  'Panini Immaculate',
  'Panini Select',
  'Panini Prizm',
  'Panini Hoops',
  'Panini Mosaic',
  'Panini Donruss',
  'Panini Optic',
  'Panini Crown Royale',
  'Panini Origins',
  'Panini One',
  'Panini One and One',
  'Panini Obsidian',
  'Panini Spectra',
  'Panini Flawless',
  'Panini Eminence',
  'Panini Court Kings',
  'Panini Threads',
  'Panini Limited',
  'Panini Contenders',
  'Panini Revolution',
  'Panini',
  'Topps Chrome',
  'Topps Finest',
  'Topps',
  'Bowman Chrome',
  'Bowman',
  'Skybox Premium',
  'Skybox',
  'Fleer Ultra',
  'Fleer',
  'Donruss',
  'Hoops',
  'Pacific',
  'Goudey',
  'Allen Ginter',
];

export interface CardKeywords {
  raw: string;
  year: string | null; // "1997-98" ou "2024"
  numbered: string | null; // "9/10"
  numberedDenom: string | null; // "/10"
  isAuto: boolean;
  isRookie: boolean;
  player: string | null; // "Tim Duncan"
  brand: string | null; // "Panini Noir"
}

function findYear(title: string): string | null {
  // 1997-98, 2022-23, 2024-25, etc.
  const m1 = title.match(/\b(19[5-9]\d|20[0-3]\d)-(\d{2})\b/);
  if (m1) return `${m1[1]}-${m1[2]}`;
  // 1997, 2024, etc.
  const m2 = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return m2 ? m2[1] : null;
}

function findBrand(title: string): string | null {
  for (const brand of KNOWN_BRANDS) {
    const escaped = brand.replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(title)) return brand;
  }
  return null;
}

function findNumbered(title: string): { full: string; denom: string } | null {
  // Format "9/10", "23/49", "1/1"
  const m = title.match(/\b(\d{1,3})\s*\/\s*(\d{1,4})\b/);
  if (m) return { full: `${m[1]}/${m[2]}`, denom: `/${m[2]}` };
  // Format "/10", "/49", "/199"
  const m2 = title.match(/(?:^|\s)\/(\d{1,4})\b/);
  if (m2) return { full: `/${m2[1]}`, denom: `/${m2[1]}` };
  return null;
}

function findPlayer(title: string, year: string | null, brand: string | null): string | null {
  // On enleve l'annee, la marque, les non-mots, puis on cherche 2 mots
  // capitalises consecutifs qui ne sont pas des mots de bruit.
  let working = title;
  if (year) working = working.replace(year, ' ');
  if (brand) {
    const escaped = brand.replace(/\s+/g, '\\s+');
    working = working.replace(new RegExp(escaped, 'gi'), ' ');
  }
  // Retire numeros de carte, /10, etc.
  working = working.replace(/#\s*\d+/g, ' ');
  working = working.replace(/\d{1,3}\s*\/\s*\d{1,4}/g, ' ');
  working = working.replace(/\/\d{1,4}/g, ' ');

  // Tokenize en gardant la casse
  const tokens = working
    .replace(/[^\w\-\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Recherche 2 mots consecutifs capitalises non-bruit
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (
      /^[A-Z][a-z]+$/.test(a) &&
      /^[A-Z][a-z]+$/.test(b) &&
      !NOISE_WORDS.has(a.toLowerCase()) &&
      !NOISE_WORDS.has(b.toLowerCase())
    ) {
      // Tente d'inclure un 3eme mot capitalise (ex: "De La Salle" / nom compose)
      const c = tokens[i + 2];
      if (c && /^[A-Z][a-z]+$/.test(c) && !NOISE_WORDS.has(c.toLowerCase())) {
        return `${a} ${b} ${c}`;
      }
      return `${a} ${b}`;
    }
  }
  return null;
}

export function extractKeywords(title: string): CardKeywords {
  const raw = title.trim();
  const year = findYear(raw);
  const brand = findBrand(raw);
  const numberedHit = findNumbered(raw);
  return {
    raw,
    year,
    brand,
    numbered: numberedHit?.full ?? null,
    numberedDenom: numberedHit?.denom ?? null,
    isAuto: /\b(auto\w*|signed)\b/i.test(raw),
    isRookie: /\b(rookie|\brc\b)\b/i.test(raw),
    player: findPlayer(raw, year, brand),
  };
}

export interface SearchQueries {
  broad: string;    // player + year (max recall)
  precise: string;  // player + year + brand + auto + /num
}

export function buildSearchQueries(kw: CardKeywords): SearchQueries {
  const broadParts = [kw.player, kw.year].filter(Boolean) as string[];
  const preciseParts = [
    kw.player,
    kw.year,
    kw.brand,
    kw.isAuto ? 'auto' : null,
    kw.numberedDenom,
  ].filter(Boolean) as string[];

  // Fallback : si pas de player extrait, on retombe sur les premiers mots
  // significatifs du titre brut (peu probable mais securise).
  if (!kw.player) {
    const fallback = kw.raw
      .split(/\s+/)
      .filter((word) => !NOISE_WORDS.has(word.toLowerCase()))
      .slice(0, 4)
      .join(' ');
    if (broadParts.length === 0) broadParts.push(fallback);
    if (preciseParts.length === 0) preciseParts.push(fallback);
  }

  return {
    broad: broadParts.join(' ').replace(/\s+/g, ' ').trim(),
    precise: preciseParts.join(' ').replace(/\s+/g, ' ').trim(),
  };
}

function encodeForUrl(query: string): string {
  return encodeURIComponent(query).replace(/%20/g, '+');
}

export function ebaySoldUrl(query: string): string {
  return `https://www.ebay.com/sch/i.html?_nkw=${encodeForUrl(query)}&LH_Sold=1&LH_Complete=1`;
}

export const point130BaseUrl = 'https://130point.com/sales/';

/**
 * 130point n'accepte pas de query string. La technique : copier la requete
 * dans le presse-papier puis ouvrir la page. L'utilisateur n'a plus qu'a
 * coller dans le champ de recherche du site.
 */
export async function openPoint130(query: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(query);
  } catch {
    // Si le navigateur refuse (ex: contexte non secure, permissions), on
    // ouvre quand meme la page. L'utilisateur tapera la requete a la main.
  }
  window.open(point130BaseUrl, '_blank', 'noopener,noreferrer');
}

