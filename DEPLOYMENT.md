# Playable Prototype Deployment

This app has two deployable pieces:

- `backend`: Express + Socket.IO game server. Deploy this to a WebSocket-friendly Node host such as Railway or Render.
- `frontend`: Next.js client. Deploy this to Vercel or any Next.js host.

## Local URLs

Backend:

```powershell
cd C:\Users\abhin\edubattle\backend
npm run start
```

Frontend:

```powershell
cd C:\Users\abhin\edubattle\frontend
npm run dev
```

Open `http://localhost:3000`.

## Backend On Railway

Create a Railway project from the `backend` folder or from a GitHub repo with the backend root selected.

Settings:

- Root directory: `backend`
- Build command: `npm install`
- Start command: `npm run start`
- Health check path: `/health`

Variables:

```text
HOST=0.0.0.0
CLIENT_ORIGIN=https://your-frontend-url.vercel.app
DATABASE_URL=postgres://...
```

Railway will provide `PORT` automatically. After deploy, copy the public backend URL.

## Backend On Render

Create a Render Web Service.

Settings:

- Root directory: `backend`
- Runtime: Node
- Build command: `npm install`
- Start command: `npm run start`
- Health check path: `/health`

Variables:

```text
HOST=0.0.0.0
CLIENT_ORIGIN=https://your-frontend-url.vercel.app
DATABASE_URL=postgres://...
```

Render will provide `PORT` automatically. After deploy, copy the public backend URL.

`DATABASE_URL` should point to a managed Postgres database. If it is omitted, the backend falls back to local JSON files in `backend/data`, which is fine for local development but not for production accounts, sessions, rankings, or match history.

## Frontend On Vercel

Create a Vercel project with:

- Root directory: `frontend`
- Framework: Next.js
- Build command: `npm run build`

Set this environment variable:

```text
NEXT_PUBLIC_SOCKET_URL=https://your-backend-url
```

Deploy, then update the backend `CLIENT_ORIGIN` to the final Vercel URL and redeploy/restart the backend.

## Sharing

Send friends the frontend URL. The backend URL is only used by the app.

For a quick test, open the frontend in two browsers or devices and click `Find Ranked Match` on both.
