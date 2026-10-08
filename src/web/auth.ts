import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

const LOGIN_TTL_MS = 10 * 60_000;
const MAX_CODE_ATTEMPTS = 5;
export const SESSION_TTL_MS = 30 * 24 * 3600_000;

const sha256 = (value: string) => createHash("sha256").update(value).digest();
const sameHash = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export interface LoginChallenge {
  /** Lien à ouvrir dans le navigateur à connecter. */
  url: string;
  /** Alternative : code à taper sur la page de connexion. */
  code: string;
}

/**
 * Connexion sans mot de passe : un lien et un code à usage unique, envoyés sur le Telegram
 * du propriétaire. Une seule demande en cours à la fois, gardée en mémoire.
 */
export class LoginLinks {
  private pending: { tokenHash: Buffer; codeHash: Buffer; expiresAt: number; attempts: number } | null = null;

  constructor(
    private readonly publicUrl: string,
    private readonly clock: () => number = Date.now,
  ) {}

  create(): LoginChallenge {
    const token = randomBytes(32).toString("base64url");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    this.pending = { tokenHash: sha256(token), codeHash: sha256(code), expiresAt: this.clock() + LOGIN_TTL_MS, attempts: 0 };
    return { url: `${this.publicUrl}/auth/callback?token=${token}`, code };
  }

  consumeToken(token: string): boolean {
    return this.consume((pending) => sameHash(pending.tokenHash, sha256(token)));
  }

  /** Après 5 codes faux, la demande est annulée : il faut en redemander une. */
  consumeCode(code: string): boolean {
    return this.consume((pending) => sameHash(pending.codeHash, sha256(code.replace(/\s/g, ""))));
  }

  private consume(matches: (pending: NonNullable<LoginLinks["pending"]>) => boolean): boolean {
    const pending = this.pending;
    if (!pending || pending.expiresAt <= this.clock()) {
      this.pending = null;
      return false;
    }
    if (matches(pending)) {
      this.pending = null;
      return true;
    }
    pending.attempts += 1;
    if (pending.attempts >= MAX_CODE_ATTEMPTS) this.pending = null;
    return false;
  }
}
