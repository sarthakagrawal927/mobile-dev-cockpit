import { useEffect, useState } from "react";
import { router } from "expo-router";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { Badge, Button, Card, Label, StatusDot } from "../components/ui";
import { getLastBridgeUrl } from "../lib/credential-store";
import { useConnection } from "../lib/connection";
import { deriveCockpitLayout } from "../lib/layout";
import { colors } from "../lib/theme";

type ConnectionMode = "tailscale" | "local";

export default function HomeScreen() {
  const connection = useConnection();
  const window = useWindowDimensions();
  const layout = deriveCockpitLayout(window.width, window.height);
  const [url, setUrl] = useState("");
  const [connectionMode, setConnectionMode] =
    useState<ConnectionMode>("tailscale");
  const [pairingToken, setPairingToken] = useState("");
  const [busy, setBusy] = useState(false);
  const insecure = url.trim().startsWith("ws://");
  const secure = url.trim().startsWith("wss://");

  useEffect(() => {
    let active = true;
    void getLastBridgeUrl().then((savedUrl) => {
      if (!active || !savedUrl) return;
      setUrl(savedUrl);
      setConnectionMode(savedUrl.startsWith("wss://") ? "tailscale" : "local");
    });
    return () => {
      active = false;
    };
  }, []);

  const selectConnectionMode = (mode: ConnectionMode): void => {
    setConnectionMode(mode);
    setUrl((current) => {
      if (mode === "local" && (!current || current.startsWith("wss://"))) {
        return "ws://127.0.0.1:4782";
      }
      if (mode === "tailscale" && current.startsWith("ws://")) return "";
      return current;
    });
  };

  const updateUrl = (value: string): void => {
    setUrl(value);
    if (value.startsWith("wss://")) setConnectionMode("tailscale");
    if (value.startsWith("ws://")) setConnectionMode("local");
  };

  const connect = async (): Promise<void> => {
    setBusy(true);
    try {
      await connection.connect(url, pairingToken.trim() || undefined);
      setPairingToken("");
    } catch {
      // The connection provider owns the actionable message.
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.glowTop} />
      <View style={styles.glowSide} />
      <ScrollView
        contentContainerStyle={[
          styles.page,
          { maxWidth: layout.contentMaxWidth },
          layout.mode === "regular" && styles.pageRegular,
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.hero}>
          <View style={styles.heroTopline}>
            <Badge tone="warning">Parked prototype</Badge>
            <Text maxFontSizeMultiplier={1.6} style={styles.version}>
              Reference build · no deployment target
            </Text>
          </View>
          <Text maxFontSizeMultiplier={1.8} style={styles.title}>
            A retained mobile build-loop experiment.
          </Text>
          <Text maxFontSizeMultiplier={2} style={styles.subtitle}>
            The source can pair a trusted machine, preview a site, supervise an
            agent, and review changes. Product work is parked: there is no
            active deployment, Fleet integration target, or completed
            physical-device gate.
          </Text>
          <View style={styles.steps}>
            {[
              ["01", "Bridge"],
              ["02", "Pair"],
              ["03", "Inspect"],
            ].map(([number, label]) => (
              <View key={number} style={styles.step}>
                <Text maxFontSizeMultiplier={1.6} style={styles.stepNumber}>
                  {number}
                </Text>
                <Text maxFontSizeMultiplier={1.6} style={styles.stepLabel}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {connection.snapshot ? (
          <>
            <Card elevated>
              <View style={styles.row}>
                <View style={styles.machineTitle}>
                  <StatusDot active={connection.status === "connected"} />
                  <View>
                    <Text style={styles.cardTitle}>
                      {connection.snapshot.machineName}
                    </Text>
                    <Text style={styles.meta}>Trusted development machine</Text>
                  </View>
                </View>
                <Badge
                  tone={
                    connection.status === "connected" ? "success" : "warning"
                  }
                >
                  {connection.status}
                </Badge>
              </View>
              <Text style={styles.meta}>
                Bridge {connection.snapshot.bridgeVersion} · protocol{" "}
                {connection.snapshot.protocolVersion}
              </Text>
              <View style={styles.machineActions}>
                <View style={styles.flex}>
                  <Button variant="secondary" onPress={connection.disconnect}>
                    Disconnect
                  </Button>
                </View>
                <View style={styles.flex}>
                  <Button
                    variant="danger"
                    onPress={() => void connection.forget()}
                  >
                    Forget
                  </Button>
                </View>
              </View>
            </Card>

            <View style={styles.sectionHeader}>
              <View>
                <Label>Projects</Label>
                <Text style={styles.meta}>
                  {connection.snapshot.projects.length} enrolled
                </Text>
              </View>
              <Button
                variant="secondary"
                accessibilityLabel="Add a discovered project"
                onPress={() => router.push({ pathname: "/enroll" } as never)}
              >
                Add project
              </Button>
            </View>
            <View
              style={[
                styles.projectGrid,
                layout.mode === "regular" && styles.projectGridRegular,
              ]}
            >
              {connection.snapshot.projects.map((project, index) => {
                const running = Object.values(project.processes).filter(
                  (process) => process?.phase === "running",
                ).length;
                return (
                  <View
                    key={project.id}
                    style={
                      layout.mode === "regular"
                        ? styles.projectGridItem
                        : undefined
                    }
                  >
                    <Card style={styles.projectCard}>
                      <View style={styles.row}>
                        <View style={styles.projectIdentity}>
                          <Text style={styles.projectIndex}>
                            {String(index + 1).padStart(2, "0")}
                          </Text>
                          <View style={styles.flex}>
                            <Text style={styles.cardTitle}>{project.name}</Text>
                            <Text style={styles.meta}>
                              {running
                                ? `${running} active process${running === 1 ? "" : "es"}`
                                : "Ready for a new session"}
                            </Text>
                          </View>
                        </View>
                        <Badge tone={running ? "accent" : "muted"}>
                          {running ? "Live" : project.source}
                        </Badge>
                      </View>
                      <Text style={styles.capabilities}>
                        {Object.entries(project.capabilities)
                          .filter(([, enabled]) => enabled)
                          .map(([name]) =>
                            name === "agentResume" ? "resume" : name,
                          )
                          .join("  ·  ")}
                      </Text>
                      <Button
                        onPress={() =>
                          router.push({
                            pathname: "/project/[id]",
                            params: { id: project.id },
                          })
                        }
                      >
                        Open project
                      </Button>
                    </Card>
                  </View>
                );
              })}
              {connection.snapshot.projects.length === 0 ? (
                <Card style={styles.projectCard}>
                  <Text style={styles.cardTitle}>No projects enrolled yet</Text>
                  <Text style={styles.meta}>
                    Discover repositories inside the roots approved when the
                    bridge started.
                  </Text>
                  <Button
                    onPress={() =>
                      router.push({ pathname: "/enroll" } as never)
                    }
                  >
                    Add your first project
                  </Button>
                </Card>
              ) : null}
            </View>
          </>
        ) : (
          <Card elevated>
            <View style={styles.row}>
              <Label>Trusted machine</Label>
              <Badge tone={connectionMode === "tailscale" ? "accent" : "muted"}>
                {connectionMode === "tailscale" ? "Secure" : "Development"}
              </Badge>
            </View>
            <View style={styles.modeSwitch}>
              <View style={styles.flex}>
                <Button
                  variant={
                    connectionMode === "tailscale" ? "primary" : "secondary"
                  }
                  onPress={() => selectConnectionMode("tailscale")}
                >
                  Tailscale
                </Button>
              </View>
              <View style={styles.flex}>
                <Button
                  variant={connectionMode === "local" ? "primary" : "secondary"}
                  onPress={() => selectConnectionMode("local")}
                >
                  Local / LAN
                </Button>
              </View>
            </View>
            <View style={styles.transportNote}>
              <Text style={styles.transportTitle}>
                {connectionMode === "tailscale"
                  ? "Private HTTPS through your tailnet"
                  : "Fast setup on this Mac or trusted Wi-Fi"}
              </Text>
              <Text style={styles.meta}>
                {connectionMode === "tailscale"
                  ? "Start the bridge with --tailscale, then paste the printed wss:// MagicDNS URL."
                  : "Use plain WebSocket only for simulator or local development."}
              </Text>
            </View>
            <TextInput
              value={url}
              onChangeText={updateUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder={
                connectionMode === "tailscale"
                  ? "wss://your-mac.tailnet.ts.net/mobile-dev-cockpit"
                  : "ws://127.0.0.1:4782"
              }
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <TextInput
              value={pairingToken}
              onChangeText={setPairingToken}
              autoComplete="one-time-code"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="One-time pairing token"
              placeholderTextColor={colors.muted}
              secureTextEntry
              style={styles.input}
              textContentType="oneTimeCode"
            />
            {insecure ? (
              <Text style={styles.warning}>
                Development-only transport. Use Tailscale for remote access.
              </Text>
            ) : null}
            {secure ? (
              <Text style={styles.secure}>Encrypted transport ready.</Text>
            ) : null}
            {connection.error ? (
              <Text style={styles.error}>{connection.error}</Text>
            ) : null}
            <Button busy={busy} onPress={() => void connect()}>
              {busy ? "Connecting" : "Pair or reconnect"}
            </Button>
            <Text style={styles.meta}>
              Leave the token blank to reuse a credential already stored on this
              device.
            </Text>
          </Card>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.canvas },
  page: {
    padding: 20,
    paddingBottom: 56,
    gap: 15,
    width: "100%",
    alignSelf: "center",
  },
  pageRegular: { paddingHorizontal: 32, gap: 18 },
  hero: { paddingTop: 34, paddingBottom: 18, gap: 14 },
  heroTopline: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  version: { color: colors.muted, fontSize: 11, letterSpacing: 0.8 },
  title: {
    color: colors.text,
    fontSize: 41,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -1.7,
  },
  subtitle: {
    color: colors.muted,
    fontSize: 16,
    lineHeight: 24,
    maxWidth: 560,
  },
  steps: { flexDirection: "row", gap: 8, marginTop: 4 },
  step: {
    flex: 1,
    backgroundColor: colors.panelSoft,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 11,
    paddingVertical: 10,
  },
  stepNumber: { color: colors.accent, fontSize: 10, fontWeight: "800" },
  stepLabel: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  input: {
    backgroundColor: colors.code,
    color: colors.text,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 15,
    minHeight: 52,
    paddingHorizontal: 14,
    fontSize: 15,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  flex: { flex: 1 },
  machineTitle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  machineActions: { flexDirection: "row", gap: 8 },
  projectIdentity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  projectIndex: {
    color: colors.violet,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: "700" },
  meta: { color: colors.muted, fontSize: 13, lineHeight: 18 },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 14,
    paddingHorizontal: 2,
  },
  projectGrid: { gap: 15 },
  projectGridRegular: { flexDirection: "row", flexWrap: "wrap" },
  projectGridItem: { width: "48.8%" },
  projectCard: { flex: 1 },
  capabilities: {
    color: colors.muted,
    textTransform: "uppercase",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.55,
    lineHeight: 17,
  },
  modeSwitch: { flexDirection: "row", gap: 8 },
  transportNote: {
    backgroundColor: colors.panelSoft,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 13,
    gap: 5,
  },
  transportTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  warning: { color: colors.warning, fontSize: 13, lineHeight: 19 },
  secure: { color: colors.success, fontSize: 13, lineHeight: 19 },
  error: { color: colors.danger, fontSize: 13, lineHeight: 19 },
  glowTop: {
    pointerEvents: "none",
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    top: -170,
    right: -80,
    backgroundColor: "#163E49",
    opacity: 0.46,
  },
  glowSide: {
    pointerEvents: "none",
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    left: -150,
    top: 360,
    backgroundColor: "#202C5E",
    opacity: 0.28,
  },
});
