# Espresso Shot Log signed OTA publisher

This public repository hosts signed, web-only update bundles for Espresso Shot Log.

Production deployment is deliberately manual. The `Deploy signed production OTA` GitHub Actions workflow requires an exact app commit, an increasing sequence, the matching bundle version, an allowed change category, a short note, and the literal confirmation `DEPLOY`.

The workflow then:

1. proves the private app commit is on `main` and differs from the updater-enabled native baseline only under `src/`, `public/`, or `index.html`;
2. runs the app tests, typecheck, and production build;
3. creates a bounded deterministic ZIP;
4. signs an exact manifest with the repository Actions secret;
5. publishes and re-downloads immutable GitHub Release bytes;
6. changes `v1/production.json` only after release verification;
7. verifies the public GitHub Pages pointer and bundle, rolling the pointer back if verification fails.

It cannot change Supabase, deploy Edge Functions, alter native code, or submit an App Store build. A production pointer is intentionally absent until native version 1.3.3 build 11 has passed App Review and is live.

The old unsigned `update.json` file is obsolete and is not consumed by the app.
