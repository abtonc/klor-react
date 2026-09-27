import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useFlag, useFlagDetail, useKlor, useVersionGate } from '@klor/react'

const BRAND = '#7c5cff'
const INK = '#edebf2'
const MUTED = '#9b96a8'
const LINE = '#26232f'

export default function Screen() {
  const checkout = useFlag('checkout_v2', false)
  const greeting = useFlag('greeting', 'fallback-greeting')
  const maxItems = useFlag('max_items', -1)
  const theme = useFlag('theme', { mode: 'fallback', density: 'fallback' })
  const betaBanner = useFlag('beta_banner', false)

  // A public key never receives a flag marked sensitive, so this stays the
  // fallback no matter what is configured.
  const sensitive = useFlag('internal_margin', { margin: -1 })

  const detail = useFlagDetail('checkout_v2', false)
  const klor = useKlor()
  const gate = useVersionGate()

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.wordmark}>Klor.</Text>
        <Text style={styles.subtitle}>
          Evaluated on this device. Nothing about the user is sent to Klor.
        </Text>

        <Section title="Flags">
          <Row label="checkout_v2" value={checkout} testID="checkout_v2" />
          <Row label="greeting" value={greeting} testID="greeting" />
          <Row label="max_items" value={maxItems} testID="max_items" />
          <Row label="theme" value={theme} testID="theme" />
          <Row label="beta_banner" value={betaBanner} testID="beta_banner" />
          <Row label="internal_margin (sensitive)" value={sensitive} testID="internal_margin" />
        </Section>

        <Section title="Why">
          <Row label="checkout_v2 reason" value={detail.reason} testID="reason" />
          <Row label="matched rule" value={detail.ruleId ?? 'none'} testID="rule" />
        </Section>

        <Section title="Connection">
          <Row label="ready" value={klor.isReady} testID="ready" />
          <Row label="stale" value={klor.isStale} testID="stale" />
          <Row label="snapshot" value={klor.seq ?? 'none'} testID="seq" />
        </Section>

        <Pressable style={styles.button} onPress={() => void klor.refresh()}>
          <Text style={styles.buttonText}>Refresh now</Text>
        </Pressable>
      </ScrollView>

      {/* Klor ships no UI for this on purpose: it returns the verdict and the
          copy, and the prompt is yours so it looks like your app. */}
      <Modal visible={gate.status !== 'none'} transparent animationType="fade">
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>
              {gate.status === 'forced' ? 'Update required' : 'Update available'}
            </Text>
            <Text style={styles.dialogBody}>{gate.message ?? 'A newer version is available.'}</Text>
            <Text style={styles.dialogMeta}>
              You are on {gate.currentVersion ?? 'an unknown version'}; the latest is{' '}
              {gate.latestVersion ?? 'unknown'} ({gate.reason}).
            </Text>

            <Pressable
              style={styles.button}
              onPress={() => gate.storeUrl && void Linking.openURL(gate.storeUrl)}
            >
              <Text style={styles.buttonText}>Update</Text>
            </Pressable>

            {/* A forced gate has no way past it, which is the entire point. */}
            {gate.status === 'optional' && (
              <Text style={styles.dismiss} testID="dismissable">
                Not now
              </Text>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  )
}

function Row({ label, value, testID }: { label: string; value: unknown; testID: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value} testID={testID}>
        {typeof value === 'string' ? value : JSON.stringify(value)}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0b0a0f' },
  content: { padding: 24, paddingBottom: 48 },
  wordmark: { color: INK, fontSize: 28, fontWeight: '600', fontFamily: 'Menlo' },
  subtitle: { color: MUTED, fontSize: 13, marginTop: 6, lineHeight: 19 },
  section: { marginTop: 28 },
  sectionTitle: { color: MUTED, fontSize: 12, textTransform: 'uppercase', letterSpacing: 1.2 },
  card: { marginTop: 8, borderWidth: 1, borderColor: LINE, borderRadius: 12, overflow: 'hidden' },
  row: { paddingHorizontal: 14, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: LINE },
  label: { color: MUTED, fontSize: 12 },
  value: { color: INK, fontSize: 15, fontFamily: 'Menlo', marginTop: 3 },
  button: {
    marginTop: 20,
    backgroundColor: BRAND,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(11,10,15,0.85)',
    justifyContent: 'center',
    padding: 28,
  },
  dialog: { backgroundColor: '#121119', borderRadius: 16, borderWidth: 1, borderColor: LINE, padding: 22 },
  dialogTitle: { color: INK, fontSize: 19, fontWeight: '600' },
  dialogBody: { color: INK, fontSize: 14, marginTop: 10, lineHeight: 20 },
  dialogMeta: { color: MUTED, fontSize: 12, marginTop: 10 },
  dismiss: { color: MUTED, fontSize: 14, textAlign: 'center', marginTop: 14 },
})
