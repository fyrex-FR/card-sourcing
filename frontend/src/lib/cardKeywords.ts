/**
 * Extracteur de mots-cles depuis un titre eBay de carte NBA.
 *
 * Approche : on ne maintient PAS de liste figee de marques/sets/inserts (trop
 * volatile, change chaque saison). On extrait les champs structures
 * deterministes (annee, joueur, auto, rookie, numerote) puis on garde
 * TOUT le reste apres avoir retire les mots de bruit purs.
 *
 * Ce reste = "context" = brand + insert + parallel + reste utile pour
 * differencier la carte. C'est ce qui permet a la recherche eBay sold ou
 * 130point d'etre precise (ex: "Cosmic Chrome Planetary Pursuit Sun" reste
 * dans le contexte).
 */

const NOISE_WORDS = new Set([
  // Bruit pur eBay (n'apporte rien a la recherche de comps)
  'card', 'cards', 'nba', 'basketball', 'trading', 'sealed', 'lot', 'free',
  'shipping', 'official', 'authentic', 'rare', 'true', 'beautiful', 'looking',
  'awesome', 'super', 'wow', 'hot', 'new', 'fresh', 'pack', 'unopened',
  // Grading (mots et abreviations)
  'psa', 'bgs', 'sgc', 'cgc', 'gem', 'mt', 'nm', 'ex', 'ungraded', 'graded',
  'mint', 'condition',
  // Equipes NBA (redondant avec le nom du joueur, brouille la recherche)
  'spurs', 'lakers', 'bulls', 'warriors', 'celtics', 'heat', 'rockets', 'nets',
  'knicks', 'sixers', 'mavs', 'mavericks', 'thunder', 'okc', 'wolves',
  'timberwolves', 'pacers', 'hawks', 'magic', 'pistons', 'kings', 'jazz',
  'nuggets', 'clippers', 'blazers', 'grizzlies', 'hornets', 'wizards',
  'raptors', 'bucks', 'cavs', 'cavaliers',
  // Vendeur / fournisseur
  'cng',
]);

/**
 * Mots qui apparaissent dans un nom de set, d'insert ou de parallele NBA.
 * On NE LES UTILISE PAS pour la detection du nom du joueur (sinon on
 * extrait "Topps Cosmic" ou "Planetary Pursuit" comme joueur).
 * Mais on les GARDE dans le contexte de recherche (ils sont essentiels
 * pour cibler le bon insert sur eBay sold / 130point).
 */
const SET_HINT_WORDS = new Set([
  // Marques
  'panini', 'topps', 'bowman', 'upper', 'deck', 'score', 'board', 'stadium',
  'club', 'skybox', 'fleer', 'donruss', 'hoops', 'pacific', 'goudey', 'ginter',
  'allen', 'metal', 'leaf', 'sage', 'press', 'pass',
  // Sets / inserts / collections recurrents
  'chrome', 'finest', 'refractor', 'cosmic', 'optic', 'prizm', 'mosaic',
  'select', 'noir', 'immaculate', 'origins', 'obsidian', 'spectra', 'flawless',
  'eminence', 'crown', 'royale', 'court', 'threads', 'limited',
  'contenders', 'revolution', 'absolute', 'studio', 'illusions', 'phoenix',
  'national', 'treasures', 'hometown', 'legacy', 'dominion', 'recon',
  'instant', 'impact', 'rookies', 'box', 'office', 'one',
  // Inserts / paralleles a theme
  'planetary', 'pursuit', 'explosion', 'pulsar', 'genesis', 'stellar', 'lunar',
  'solar', 'galaxy', 'orbit', 'nebula', 'meteor', 'starbright', 'kaboom',
  'downtown', 'color', 'blast', 'cracked', 'ice', 'wave', 'tiger', 'shimmer',
  'velocity', 'fast', 'break', 'fireworks', 'choice', 'mojo',
  // Materiel / forme
  'auto', 'autograph', 'autographs', 'signature', 'signatures', 'signed',
  'foil', 'holo', 'holographic', 'memorabilia', 'jersey', 'patch', 'patches',
  'worn', 'game', 'rookie',
  // Couleurs / paralleles standards
  'silver', 'gold', 'red', 'blue', 'green', 'orange', 'purple', 'black',
  'white', 'pink', 'yellow', 'platinum', 'rainbow', 'sapphire', 'emerald',
  'ruby', 'diamond', 'aqua', 'teal',
  // Mots techniques
  'promos', 'promo', 'numbered', 'parallel', 'insert', 'rare', 'short', 'print',
]);

export interface CardKeywords {
  raw: string;
  year: string | null;            // "1997-98" ou "2024"
  numbered: string | null;        // "9/10"
  numberedDenom: string | null;   // "/10"
  isAuto: boolean;
  isRookie: boolean;
  player: string | null;          // "Tim Duncan"
  context: string | null;         // "Topps Cosmic Chrome Planetary Pursuit Sun"
}

function findYear(title: string): string | null {
  const m1 = title.match(/\b(19[5-9]\d|20[0-3]\d)-(\d{2})\b/);
  if (m1) return `${m1[1]}-${m1[2]}`;
  const m2 = title.match(/\b(19[5-9]\d|20[0-3]\d)\b/);
  return m2 ? m2[1] : null;
}

function findNumbered(title: string): { full: string; denom: string } | null {
  const m = title.match(/\b(\d{1,3})\s*\/\s*(\d{1,4})\b/);
  if (m) return { full: `${m[1]}/${m[2]}`, denom: `/${m[2]}` };
  const m2 = title.match(/(?:^|\s)\/(\d{1,4})\b/);
  if (m2) return { full: `/${m2[1]}`, denom: `/${m2[1]}` };
  return null;
}

/**
 * Cherche le nom du joueur : 2-3 tokens consecutifs capitalises, hors bruit
 * et hors mots typiques de set/insert/parallele. Sinon on extrait "Topps
 * Cosmic" ou "Planetary Pursuit" qui ne sont evidemment pas des joueurs.
 */
function findPlayer(title: string, year: string | null): string | null {
  let working = title;
  if (year) working = working.replace(year, ' ');
  // Numerotation #PPS-5, #123, #100
  working = working.replace(/#[\w-]+/g, ' ');
  // Format 9/10, /10
  working = working.replace(/\d{1,3}\s*\/\s*\d{1,4}/g, ' ');
  working = working.replace(/\/\d{1,4}/g, ' ');

  const tokens = working
    .replace(/[^\w\-\s']/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const looksLikeProperNoun = (token: string) => {
    // [A-Z] + au moins 1 lettre, et au moins 1 minuscule. Ca exclut les
    // abreviations type "SB", "PSA", "BGS", "RC", "CNG" tout en acceptant
    // "LeBron", "DeAndre", "O'Neal", "Tim".
    if (!/^[A-Z][a-zA-Z']+$/.test(token)) return false;
    if (!/[a-z]/.test(token)) return false;
    return true;
  };

  const isPlayerCandidate = (token: string) => {
    if (!looksLikeProperNoun(token)) return false;
    const lower = token.toLowerCase();
    if (NOISE_WORDS.has(lower)) return false;
    if (SET_HINT_WORDS.has(lower)) return false;
    return true;
  };

  // 1ere passe : on cherche 2 mots consecutifs qui passent les criteres
  // (la plupart des joueurs NBA ont un prenom + nom de famille en 2 mots).
  for (let i = 0; i < tokens.length - 1; i++) {
    if (isPlayerCandidate(tokens[i]) && isPlayerCandidate(tokens[i + 1])) {
      return `${tokens[i]} ${tokens[i + 1]}`;
    }
  }

  // 2eme passe : on tolere SET_HINT_WORDS (au cas ou un joueur ait un nom
  // qui collisionne avec un mot de set, ex: hypothetique "Sun Smith").
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i];
    const b = tokens[i + 1];
    if (
      looksLikeProperNoun(a) &&
      looksLikeProperNoun(b) &&
      !NOISE_WORDS.has(a.toLowerCase()) &&
      !NOISE_WORDS.has(b.toLowerCase())
    ) {
      return `${a} ${b}`;
    }
  }
  return null;
}

/**
 * Construit le contexte : tout ce qui reste apres avoir retire les champs
 * structures (annee, joueur, numerotation, auto, rookie, card number) et
 * les mots de bruit. Conserve l'ordre d'apparition pour rester lisible.
 */
function buildContext(
  title: string,
  year: string | null,
  player: string | null,
  numbered: string | null,
): string | null {
  let working = title;
  if (year) working = working.replace(year, ' ');
  if (player) working = working.replace(new RegExp(player.replace(/\s+/g, '\\s+'), 'i'), ' ');
  if (numbered) working = working.replace(numbered, ' ');
  // Numero de carte (#PPS-5, #123)
  working = working.replace(/#[\w-]+/g, ' ');
  // Numerotation forme /xxx
  working = working.replace(/\/\d{1,4}/g, ' ');
  // Mots flag (auto/rookie) - reportes par le flag, on evite la duplication
  working = working.replace(/\b(autograph|autographs|auto|signed|signatures?)\b/gi, ' ');
  working = working.replace(/\brookie\b/gi, ' ');
  working = working.replace(/\brc\b/gi, ' ');
  // Numerotation seule "9 of 10" "1 of 1"
  working = working.replace(/\b\d{1,3}\s+of\s+\d{1,4}\b/gi, ' ');
  // Ponctuation / tirets / points
  working = working.replace(/[^\w\s]/g, ' ');

  const tokens = working
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => {
      const lower = t.toLowerCase();
      if (NOISE_WORDS.has(lower)) return false;
      // Drop tokens d'une seule lettre (sauf chiffre)
      if (t.length === 1 && !/\d/.test(t)) return false;
      // Drop tokens purement numeriques courts (souvent du bruit type "5", "10")
      if (/^\d{1,2}$/.test(t)) return false;
      return true;
    });

  if (tokens.length === 0) return null;
  return tokens.join(' ');
}

export function extractKeywords(title: string): CardKeywords {
  const raw = title.trim();
  const year = findYear(raw);
  const numberedHit = findNumbered(raw);
  const player = findPlayer(raw, year);
  const context = buildContext(raw, year, player, numberedHit?.full ?? null);
  return {
    raw,
    year,
    numbered: numberedHit?.full ?? null,
    numberedDenom: numberedHit?.denom ?? null,
    isAuto: /\b(auto\w*|signed)\b/i.test(raw),
    isRookie: /\b(rookie|rc)\b/i.test(raw),
    player,
    context,
  };
}

export interface SearchQueries {
  broad: string;    // player + year (max recall)
  precise: string;  // player + year + context (+ auto + /num)
}

export function buildSearchQueries(kw: CardKeywords): SearchQueries {
  const broadParts = [kw.player, kw.year].filter(Boolean) as string[];
  const preciseParts = [
    kw.player,
    kw.year,
    kw.context,
    kw.isAuto ? 'auto' : null,
    kw.numberedDenom,
  ].filter(Boolean) as string[];

  // Fallback : si pas de player extrait, on retombe sur le contexte brut.
  if (!kw.player) {
    const fallback = (kw.context ?? kw.raw).split(/\s+/).slice(0, 5).join(' ');
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
