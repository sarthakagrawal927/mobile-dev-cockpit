## Shared Fleet Standard

When this repository is checked out inside the Fleet workspace, also read and
follow `../AGENTS.md` before non-trivial work. Preserve unrelated changes,
avoid secrets and production configuration, and run the smallest relevant
check first.

## Project

- **Stack:** pnpm workspace; Expo Router SDK 57 / React Native / TypeScript mobile app; Node.js / TypeScript WebSocket bridge; shared TypeScript protocol.
- **Local dev:** copy `config.example.json` to the ignored `config.local.json`, edit its absolute paths, run `pnpm bridge -- --config ./config.local.json`, then `pnpm mobile`.
- **Tailscale:** keep the bridge on loopback and run `pnpm bridge -- --config ./config.local.json --tailscale`; remove only its Serve path with `pnpm bridge -- tailscale-off`. Never use Funnel for this product.
- **Checks:** `pnpm check`, `pnpm build:bridge`, `pnpm mobile:export`, and `pnpm mobile:export:ios`.
- **Deploy:** none. The project controls user-configured external deployment commands but does not deploy itself.

## Security Boundaries

- Never accept arbitrary shell source, executable paths, working directories, or argv from the mobile client.
- Only run commands declared in the bridge configuration and only inside canonical configured repository roots.
- Never inject bridge credentials or native message handlers into preview WebViews.
- Deploy, rollback, tracked-file revert, and staged commit require a fresh, bridge-enforced approval; agent prompt decisions stay inside the visible PTY session.
- Do not commit local bridge configs, session state, certificates, or repository paths.
