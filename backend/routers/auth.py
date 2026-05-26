import os

import jwt as pyjwt
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer

bearer = HTTPBearer()


async def current_user(token=Depends(bearer)) -> dict:
    try:
        jwt_secret = os.getenv("SUPABASE_JWT_SECRET")
        if not jwt_secret:
            raise HTTPException(status_code=500, detail="SUPABASE_JWT_SECRET is missing")

        payload = pyjwt.decode(
            token.credentials,
            jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
        )
    except HTTPException:
        raise
    except pyjwt.PyJWTError as exc:
        raise HTTPException(status_code=401, detail=f"invalid_token: {exc}") from exc

    allowed = [email.strip().lower() for email in os.getenv("ALLOWED_EMAILS", "").split(",") if email.strip()]
    email = (payload.get("email") or "").lower()
    if allowed and email not in allowed:
        raise HTTPException(status_code=403, detail="not_allowed")

    return payload
