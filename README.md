# Mobile Dev Cockpit

> Canonical source: this standalone repository. Site Health retains only its
> parked catalog entry and provider-resource inventory.

Mobile Dev Cockpit is a parked, local-only client for supervising a
developer-controlled machine. It is not a public application, and reactivation
requires an explicit product decision.

A native iPhone and iPad cockpit for a developer-controlled machine: pair once, enroll a discovered repository, run its dev server and agent, preview the site, dictate editable instructions, review changes, run tests, and explicitly approve deployment.

## Trust model

- The bridge binds to `127.0.0.1` unless configuration explicitly opts into another host.
- Repository discovery is restricted to canonical roots supplied locally when the bridge starts. The phone cannot submit paths, working directories, executables, argv, shell text, or environment values.
- The bridge derives bounded command candidates from current package metadata, installed bridge-owned agent adapters, or a strict local repository manifest. Enrollment is a separate expiring one-use approval and never executes a command.
- Dynamic projects are re-canonicalized inside their approved root before every process or Git action. Deploy, rollback, destructive Git, and commit still require their existing fresh runtime approvals after enrollment.
- Pairing tokens expire after five minutes and can be used once. Session credentials are stored hashed by the bridge and in iOS SecureStore by the app.
- Session credentials expire after the configured bounded lifetime (24 hours by default); expired credentials must pair again.
- Preview WebViews receive only HTTP(S) URLs—never bridge credentials or a native control channel.
- Deploy, rollback, tracked-file revert, and staged commit require a fresh approval generated and consumed by the bridge.
- Coding agents run in an owned PTY. Prompt approvals are sent only to that visible session, and stopping an operation terminates the complete owned process group.
- For remote use, expose the loopback bridge through tailnet-private Tailscale Serve or another TLS reverse proxy and connect with `wss://`. The product never enables public Tailscale Funnel. Plain `ws://` is development-only.

## Setup

Requirements: Node.js 22+, pnpm 10, Git, and an Expo-compatible iOS development environment. Expo SDK 57 native builds require Xcode 26.4+ and CocoaPods.

```bash
pnpm install
pnpm build:bridge
pnpm bridge -- --root ~/Desktop/fleet
pnpm mobile
```

The bridge prints a one-time pairing token. Enter the reachable bridge URL and token in the app, tap **Add project**, review bridge-detected actions, and approve enrollment. The root is the only mandatory machine-specific repository setting: it defines the filesystem boundary the paired app may discover. Discovery includes both the root repository and nested Git repositories, so an umbrella workspace such as `~/Desktop/fleet` needs only one `--root`. Dynamic project configuration is persisted atomically in the owner-only application-support directory and restored after restart.

Use repeated `--root` arguments for more than one local workspace. A JSON config remains available for advanced networking, limits, static projects, and explicit command/environment overrides:

```bash
cp config.example.json config.local.json
pnpm bridge -- --config ./config.local.json
```

### Tailscale (recommended)

Install and sign in to Tailscale on the Mac and iPhone, keep the bridge host set to `127.0.0.1`, then run:

```bash
pnpm bridge -- --root ~/Desktop/fleet --tailscale
```

The bridge checks the local Tailscale state, configures private HTTPS Serve at `/mobile-dev-cockpit`, and prints a URL like:

```text
wss://your-mac.your-tailnet.ts.net/mobile-dev-cockpit
```

Paste that URL into the app's Tailscale connection mode. Tailscale terminates TLS and applies the tailnet's access-control policy; the underlying bridge remains reachable only on loopback. The Serve mapping runs in the background until explicitly disabled:

```bash
pnpm bridge -- tailscale-off
# or, for the built binary:
mobile-dev-cockpit-bridge tailscale-off
```

This integration uses Tailscale Serve, never Funnel. If tailnet HTTPS is not enabled yet, follow the one-time consent flow described in the [Tailscale Serve documentation](https://tailscale.com/docs/features/tailscale-serve).

For a built bridge instead of the TypeScript development entrypoint:

```bash
pnpm --filter @mobile-dev-cockpit/bridge start -- --root ~/Desktop/fleet
```

To find Git repositories before configuring them:

```bash
pnpm discover -- --root ~/Desktop
```

Discovery is read-only, bounded to three directory levels and 200 results, and does not follow symlinked directories. A discovered repository is not controllable until its exact bridge-owned command candidates are explicitly approved in the app.

## Configuration

`discoveryRoots` and `projects` can be used together. Commands in static configuration are argv arrays, never shell strings. Environment variables can be declared per static project, but local configs are ignored and must not contain secrets unless the configured command itself requires them.

```json
{
  "machineName": "My Mac",
  "host": "127.0.0.1",
  "advertisedHost": "your-machine.tailnet.ts.net",
  "port": 4782,
  "discoveryRoots": ["/absolute/path/to/workspace"],
  "projects": [
    {
      "id": "example",
      "name": "Example site",
      "repositoryPath": "/absolute/path/to/example",
      "previewUrl": "http://127.0.0.1:5173",
      "productionUrl": "https://example.com",
      "commands": {
        "dev": ["pnpm", "dev", "--host", "0.0.0.0"],
        "tunnel": ["cloudflared", "tunnel", "--url", "http://127.0.0.1:5173"],
        "build": ["pnpm", "build"],
        "test": ["pnpm", "test"],
        "agent": ["codex", "--no-alt-screen", "-a", "on-request"],
        "agentResume": [
          "codex",
          "--no-alt-screen",
          "-a",
          "on-request",
          "resume",
          "--last"
        ],
        "deploy": ["pnpm", "deploy"]
      }
    }
  ]
}
```

`127.0.0.1` in a preview URL refers to the phone when loaded there. For a physical device, set `advertisedHost` to the Mac's MagicDNS name or configure another HTTPS preview URL reachable from the phone.
When a development process prints an HTTP(S) URL, the bridge detects it and publishes it to the app. `advertisedHost` rewrites loopback hostnames in detected URLs to a phone-reachable LAN or Tailscale host.
An optional configured `tunnel` argv can run a user-installed tool such as `cloudflared`; the first HTTP(S) URL it prints becomes the project preview URL. Mobile Dev Cockpit does not install, authenticate, or manage that external tunnel provider.
The example Codex commands use the installed CLI's interactive approval mode and resume its latest local session. Replace them with another allowlisted agent argv when needed.

For repositories that are not Node projects, an optional local `.mobile-dev-cockpit.json` can declare a strict `commands` object using the same argv-array shape. The bridge labels every manifest command as guarded until enrollment approval. The mobile app never edits this file.

## iPad and Apple Speech

The same universal binary supports iPhone and iPad portrait, landscape, Split View, and Stage Manager. Layout follows the current window width: compact windows retain horizontal section tabs, while regular-width iPad windows show persistent section navigation beside a flexible workspace. On iPad, preview orientation changes the in-canvas viewport and never locks the system orientation or disables multitasking.

The agent composer includes a dedicated Apple-native voice draft interface:

- iOS 26 and newer use `SpeechAnalyzer` and `SpeechTranscriber`; iOS 16.4–25 use `SFSpeechRecognizer`.
- `AVAudioEngine` owns microphone capture and releases it on finish, cancel, interruption, route change, or screen unmount.
- On-device recognition is the default. If it is unavailable, the app requires explicit one-time consent before Apple Speech may recognize that recording online.
- Raw audio never crosses the React Native boundary and is never sent to the bridge, coding agent, or a third-party speech service.
- Final speech becomes editable text. The existing **Send instruction** action remains a separate explicit step.

The web development fallback reports voice as unsupported; it does not simulate microphone behavior.

Native screenshot delivery writes a validated JPEG or PNG to the bridge's private state directory and sends only that local path plus the optional note to the active agent PTY. Attachments are never executed.

After a successful deployment, the deploy screen offers the refreshed production URL inside the embedded preview as well as Safari. Failed or stopped deployments retain their logs without invalidating the current WebView.

## Checks

```bash
pnpm check
pnpm build:bridge
pnpm mobile:export
pnpm mobile:export:ios
```

`expo prebuild --platform ios --no-install` can generate the native project. A physical-device build still requires full Xcode and CocoaPods on the Mac. In Xcode > Settings > Apple Accounts, sign in with the Apple Account that should own the Personal Team, then connect and unlock the device, enable Developer Mode under Privacy & Security, and let automatic signing create the provisioning profile. A paid Apple Developer Program membership is not required for personal on-device testing, but free Personal Team profiles expire periodically. Voice recognition itself requires physical microphone hardware for final validation.
The generated app and every CocoaPods target share the iOS 16.4 deployment floor. This includes older privacy resource bundles that otherwise retain an iOS 9 target and fail generic physical-device builds under Xcode 27.
Every push performs a clean native prebuild, pod install, and locally signed Release compile on Xcode 26.4 or newer in GitHub Actions. CI then installs the standalone app in a simulator, launches it without Metro, and uploads a screenshot of the rendered onboarding screen.

Simulator Release builds use Xcode's **Sign to Run Locally** identity. Do not disable code signing for the installed simulator bundle: that strips the simulated application identifier used by Keychain and causes SecureStore pairing persistence to fail before the dashboard opens.

The local `with-ios-scene-lifecycle` Expo config plugin reproducibly adds UIKit's required single-window scene manifest and delegate to every generated native project. A standalone Release binary built with Xcode 27 has been installed and launched without Metro on iOS 26.4 and iOS 27 iPhone simulators and an iOS 27 iPad simulator. The plugin keeps multiple scenes disabled, preserves Expo/React Native lifecycle subscribers, and forwards scene-delivered URLs and user activities through the existing linking handlers.

Active feature contracts live in `openspec/changes/` until their required simulator and physical-device evidence is complete and they are archived.
