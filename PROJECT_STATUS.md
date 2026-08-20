# Mobile Dev Cockpit — PROJECT STATUS

Last updated: 2026-08-20

## Why / What

Mobile Dev Cockpit is a native universal iPhone and iPad interface for supervising development on a laptop or remote machine: discover and explicitly enroll a repository, start its dev server, preview the website, instruct a coding agent by text or Apple-native speech, review Git changes, run tests, and approve deployment.

**Status:** Parked. Source, checks, and retained provider inventory remain for
reference, but there is no active product work, physical-device verification,
deployment, or Fleet Console integration target.

**Users:** Developers using Codex, Claude Code, or another configured CLI agent who want to supervise an edit-to-deploy loop from an iPhone or iPad.

**IN scope:** Single-user machine pairing, bounded repository discovery, explicit command enrollment, streamed logs, text and native voice agent supervision, adaptive iPhone/iPad workspaces, isolated WebView preview, Git review, tests, and guarded deploy/rollback.

**OUT of scope:** General SSH, arbitrary remote shell, full code editing, hosted relay/accounts, collaboration, Android, plugin marketplace, hosting, and device-farm testing.

## Dependencies

### External

- Expo SDK 57, React Native, Expo Router, SecureStore, WebView, view capture, and system sharing.
- Xcode 26.4+ and CocoaPods for native iOS builds; the hosted simulator compile uses GitHub's macOS 26 runner, while local Xcode 27 verification covers the mandatory scene lifecycle.
- Node.js 22+, the `ws` WebSocket server package, and `node-pty` for owned interactive agent sessions.
- Git and whichever dev, test, agent, and deploy CLIs a user explicitly configures.
- Optional Tailscale CLI and a signed-in tailnet for the recommended private HTTPS remote transport; LAN or another TLS reverse proxy remains supported.

### Internal

- No runtime dependency on another fleet repository.

## Timeline

- 2026-08-20 — Extracted the parked source into its standalone repository.
  Fleet Workspace retains only catalog history and explicit ownership of the
  existing provider resources; no deployment or resource mutation occurred.
- 2026-08-20 — Parked the product at the owner's direction. Retained source and
  existing provider inventory without deployment or deletion; future work
  requires an explicit reactivation decision.
- 2026-07-12 — Product PRD accepted; OpenSpec MVP proposal, design, capability specs, and implementation tasks validated.
- 2026-07-12 — Local monorepo scaffold started for the iOS app, desktop bridge, and shared protocol.
- 2026-07-12 — Working MVP implemented and browser-smoke-tested through pairing, reconnect, project control, live logs, agent instruction, Git review, and deployment cancellation; 20/20 Expo Doctor checks and native iOS bundle export pass.
- 2026-07-13 — Closed the remaining host-independent PRD gaps: expiring sessions and cold-launch reconnect, build/tunnel controls, PTY-backed new/resume agent sessions, complete process-group shutdown, stale Git approval rejection, private screenshot-to-agent delivery, compiled bridge CLI, and CLI packaging verification.
- 2026-07-13 — Re-ran 390x844 end-to-end smoke tests through pairing, dev process lifecycle, PTY resume/instruction/stop, guarded deployment, refreshed embedded production preview, and credential cleanup with no browser errors. Workspace checks pass; web and iOS exports pass; native prebuild succeeds. Expo Doctor is 19/20 because CocoaPods is absent.
- 2026-07-13 — Added Tailscale-first onboarding and a loopback-only Tailscale Serve CLI mode with scoped setup/cleanup, MagicDNS WSS output, unsafe-binding rejection, and tests. Polished the iPhone onboarding and dashboard using local React Native primitives and visually verified both secure and local modes at 390x844.
- 2026-07-13 — Added a clean hosted native build gate: Expo prebuild, CocoaPods installation, and the complete unsigned iOS Simulator app compile and link pass on Xcode 26.4 alongside the existing 34 tests, bridge build, and platform exports.
- 2026-07-13 — Upgraded the native gate to a standalone Release build, fixed React Native workspace resolution for the shared protocol, installed and launched the bundled app in an iPhone simulator without Metro, and visually verified the uploaded native onboarding screenshot.
- 2026-07-13 — Prepared the local physical-device toolchain with Xcode 27 beta 3 and CocoaPods 1.17 and detected a paired iPhone 16 Pro and iPad Air 11-inch (M3). A current signing audit finds a valid personal Apple Development identity but no signed-in Xcode account or provisioning profile for the app; both devices are currently offline and report Developer Mode disabled.
- 2026-07-13 — Added low-configuration discovery roots and an owner-only dynamic project registry with one-use enrollment approvals; visually verified pair, discover, exact candidate review, enroll, and restored project access at phone and iPad widths.
- 2026-07-13 — Added universal iPad layouts for portrait, landscape, Split View, and Stage Manager plus a dedicated Apple-native speech composer. The app-local Swift module compiles on Xcode 27 and uses SpeechAnalyzer on iOS 26+ with an on-device SFSpeechRecognizer fallback for iOS 16.4–25.
- 2026-07-13 — Installed and launched the standalone Release app without Metro on iOS 26.4 iPhone 17 Pro and iPad Pro 13-inch simulators. Native portrait captures, browser-backed portrait/landscape/Split View captures, extreme Dynamic Type, strict OpenSpec validation, all 55 tests, bridge build, and both platform exports pass.
- 2026-07-13 — Added a generated-project-safe single-window UIScene lifecycle for iOS 27. A clean Xcode 27 Release binary launches without Metro on iOS 26.4 and iOS 27 iPhone simulators plus an iOS 27 iPad simulator; the previous pre-React-Native lifecycle assertion is gone.
- 2026-07-13 — Made the iOS 16.4 deployment floor reproducible across the generated app and every CocoaPods target. A generic physical-device Release build now compiles with Xcode 27 without a command-line deployment override; a signed retry reaches only the expected missing Apple Account/provisioning-profile gate.
- 2026-07-13 — Exercised the standalone Xcode 27 Release app through the real local bridge on an iOS 27 iPhone simulator. Fixed simulator Keychain entitlement generation, one-time-token autofill semantics, and nested repository discovery under a Git workspace root; native pairing, Keychain persistence, fleet discovery, explicit enrollment, project workspace entry, streamed command logs, and a successful configured test run now pass without Metro.

## Products

- `apps/mobile` — Expo Router iOS app with a web development fallback.
- `packages/bridge` — local Node.js machine bridge.
- `packages/protocol` — shared versioned JSON message contract.

## Features (shipped)

- Versioned shared protocol with strict runtime message validation and no arbitrary mobile command channel.
- Five-minute one-use pairing token, bounded expiring hashed session credentials, iOS SecureStore client storage, cold-launch reconnect, reconnect backoff, and full state/log recovery.
- Tailscale Serve integration that retains loopback binding, checks connected/MagicDNS state, configures only `/mobile-dev-cockpit`, prints the secure WSS URL, and removes that mapping without touching unrelated services.
- Read-only bounded repository discovery plus explicit allowlisted project configuration.
- Low-configuration bridge startup with repeated `--root` arguments, authenticated root-and-nested repository discovery, exact bridge-detected command review, expiring one-use enrollment proposals, atomic owner-only persistence, guarded updates, and idle-only removal. Mobile clients cannot submit paths, executables, arguments, shell text, or environment values.
- Configured dev/tunnel/build/test/agent/deploy/rollback processes with streamed logs, complete process-group stop controls, detected preview URLs, and advertised-host rewriting.
- Native isolated WebView preview with back, refresh, Safari, screenshot sharing, orientation control, theme hint cycling, and dev/production targets.
- Universal iPhone/iPad layouts with compact, intermediate, and regular-width navigation; portrait, landscape, Split View, and Stage Manager sizing; window-aware previews; pointer and hardware-keyboard focus; and state-preserving layout transitions.
- PTY-backed agent supervision with new/resume controls, instruction and prompt-decision streaming, active-session survival across network reconnects, and validated private screenshot attachments.
- Dedicated Apple-native voice drafting with microphone level and partial transcript feedback, explicit permission and online-recognition consent states, editable final transcripts, and a separate Send action. Audio stays inside the native module and is never sent to the bridge or coding agent.
- Bounded Git review with per-file stage/unstage, protected tracked-file revert, staged-only commit, untracked-file deletion prevention, and exact-state fingerprints that invalidate stale approvals.
- One-use expiring approval gates for deploy, rollback, revert, and commit.
- Successful deployments invalidate the embedded production preview and expose a direct in-app refresh action; failed and stopped deployments preserve the current preview.
- Compiled bridge CLI with an executable package entrypoint and reproducible native PTY helper preparation.
- Polished Tailscale-first onboarding, encrypted/development transport states, three-step setup rail, trusted-machine status, and dense project cards built without another UI dependency.
- Expo web fallback used for 390x844 visual verification and local end-to-end smoke testing; generated iOS native project and both platform bundles verified locally.
- Clean macOS 26 CI compilation of the generated native app, including all Expo/React Native pods, with the SDK 57-required Xcode 26.4 toolchain.
- Standalone Release simulator installation and launch gate with a visually inspected full-resolution native onboarding screenshot artifact.
- Standalone Release simulator pairing evidence through Keychain persistence, nested fleet discovery, explicit project enrollment, workspace navigation, bridge-owned test execution, streamed logs, and successful completion without Metro.
- Standalone universal Release installation and launch evidence on representative iPhone and iPad simulators, plus compact/intermediate/regular browser screenshots and an accessibility-extra-extra-extra-large Dynamic Type pass.
- Idempotent local Expo scene-lifecycle plugin with a single-window manifest, scene-owned React Native startup, Expo lifecycle forwarding, deep-link forwarding, template-drift tests, and standalone Xcode 27 launch evidence on iOS 26.4 and iOS 27.
- Generated iOS 16.4 app and CocoaPods deployment targets, including guarded handling for legacy privacy resource bundles that Xcode 27 otherwise rejects.

## Work queue

Open work is tracked only in [GitHub Issues](https://github.com/sarthakagrawal927/mobile-dev-cockpit/issues).
An open issue is a to-do, a linked pull request is in progress, and merge plus
issue closure makes the work done.
