import json
import os

import jwt as pyjwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

bearer = HTTPBearer()


def _load_public_key():
    jwk = os.getenv("SUPABASE_JWT_JWK")
    if jwk:
        return pyjwt.algorithms.ECAlgorithm.from_jwk(jwk)

    public_key = os.getenv("SUPABASE_JWT_PUBLIC_KEY")
    if public_key:
        return public_key

    fallback_jwk = {
        "alg": "ES256",
        "crv": "P-256",
        "kid": "ed3a0d01-318d-4e00-a40c-0e0233cd3d3f",
        "kty": "EC",
        "use": "sig",
        "x": "YCp9zlNRQ9_KENWBJlksJL1Lrjw3DaRZp4GSmm6OeMM",
        "y": "obAm1VW4xqeVZbv2ulpIaHZyFdhjuOzY5uJ5xr3i7Qc",
    }
    return pyjwt.algorithms.ECAlgorithm.from_jwk(json.dumps(fallback_jwk))


_public_key = _load_public_key()


async def current_user(token=Depends(bearer)) -> dict:
    try:
        payload = pyjwt.decode(
            token.credentials,
            _public_key,
            algorithms=["ES256", "RS256"],
            audience="authenticated",
        )
    except pyjwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid_token: {exc}") from exc

    allowed = [email.strip().lower() for email in os.getenv("ALLOWED_EMAILS", "").split(",") if email.strip()]
    email = (payload.get("email") or "").lower()
    if allowed and email not in allowed:
        raise HTTPException(status_code=403, detail="not_allowed")

    return payload
