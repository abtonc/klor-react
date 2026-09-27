# Klor with Next.js

A Next.js App Router app reading flags two ways:

- **On the server**, in a Server Component, with a private key. A private key also sees flags marked
  sensitive, so it must never reach the browser.
- **In the browser**, with a public key, hydrated from the public snapshot the server fetched, so the
  first render already has real values and nothing flashes.

It also mounts the devtools panel, reads an update gate, and reads one flag that was never published,
to show what that looks like.

## Run it

1. In [Klor](https://klor.dev), create a project and add these flags in its `dev` environment:

   | Key | Type | Notes |
   | --- | --- | --- |
   | `checkout_v2` | boolean | |
   | `greeting` | string | |
   | `max_items` | number | |
   | `theme` | JSON | for example `{ "mode": "dark", "density": "compact" }` |
   | `beta_banner` | boolean | |
   | `internal_margin` | JSON | mark it **sensitive**: only the server can read it |

   Publish the environment, then create a public key and a private key on the API keys page.

2. Copy `.env.example` to `.env.local` and paste the keys in.

3. Install and start:

   ```bash
   npm install
   npm run dev
   ```

4. Open `http://localhost:3000`. Targeting reads the user from the URL, so try
   `?userId=user-42&platform=ios&country=DE&appVersion=2.3.0` against your rules.

Everything you target on is evaluated here, in your app. None of it is sent to Klor.
