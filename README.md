# Card Sourcing

Private sourcing app for NBA card opportunities, starting with China-filtered eBay scans.

## Stack

- Backend: FastAPI
- Frontend: Vite + React
- Auth/data: Supabase
- Marketplace scan: eBay Browse API

## MVP Scope

- Supabase login
- Private watchlists
- Manual scan against eBay active listings
- Country and max-price filters
- Result triage: watching, ignored, bought, too expensive

## Setup

Apply `backend/sql/001_sourcing_schema.sql` in Supabase SQL editor.

Backend env:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
SUPABASE_JWT_JWK=
ALLOWED_EMAILS=xavier@example.com,friend@example.com
EBAY_CLIENT_ID=
EBAY_CLIENT_SECRET=
CORS_ORIGINS=https://your-frontend-domain.example
```

Frontend env:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:8000
```

Local run:

```bash
cd backend
uvicorn main:app --reload

cd frontend
npm install
npm run dev
```
