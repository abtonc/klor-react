# Klor with Expo

An Expo Router app wired the way a React Native app should be:

- **AsyncStorage** as `storage`, so a cold start with no signal opens with the last configuration
  rather than fallbacks.
- **AppState** for `subscribeToForeground`, to refresh when the app comes back, and
  `subscribeToBackground`, to flush usage counters on the way out, since React Native has no
  `visibilitychange`.
- **The installed binary's version** from `expo-application`, for update gating. The app config's
  version is baked into the JavaScript bundle, so after an OTA update it can claim a version the
  native shell is not.

## Run it

1. In [Klor](https://klor.dev), create a project and add these flags in its `dev` environment:
   `checkout_v2` (boolean), `greeting` (string), `max_items` (number), `theme` (JSON) and
   `beta_banner` (boolean). Publish, then create a public key on the API keys page.

2. Copy `.env.example` to `.env` and paste the public key in.

3. Install and start:

   ```bash
   npm install
   npx expo start
   ```

   Open it in Expo Go or a simulator. In Expo Go, the installed version is Expo Go's own, so an
   update gate reads that rather than this app's.

A mobile app only ever gets a **public** key. Anything in a shipped binary can be extracted, so flags
that must stay private are marked sensitive and read from your server instead.
