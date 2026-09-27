import { useState } from 'react'
import { AppState, Platform } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { KlorProvider, createKlorClient } from '@klor/react'
import * as Application from 'expo-application'

/**
 * Everything React Native needs, in one place.
 *
 * `@klor/react` has no `react-native` dependency, which is what lets one
 * install serve web, native and the server. The three platform pieces are
 * passed in here instead.
 */
export default function RootLayout() {
  const [client] = useState(() =>
    createKlorClient({
      apiKey: process.env['EXPO_PUBLIC_KLOR_PUBLIC_KEY'] ?? '',
      baseUrl: process.env['EXPO_PUBLIC_KLOR_BASE_URL'] ?? 'https://edge.klor.dev',

      // 1. Persistence. Without it a cold start with no signal serves fallbacks
      //    instead of the last configuration the device had, which on mobile is
      //    the case most worth covering.
      storage: AsyncStorage,

      // 2. Coming back to the app is the moment config is most likely stale.
      subscribeToForeground: (refresh) => {
        const subscription = AppState.addEventListener(
          'change',
          (state) => state === 'active' && refresh(),
        )
        return () => subscription.remove()
      },

      // 3. Leaving is when a buffered counter would otherwise be lost. The web
      //    gets this free from `visibilitychange`; there is no such event here.
      subscribeToBackground: (flush) => {
        const subscription = AppState.addEventListener(
          'change',
          (state) => state !== 'active' && flush(),
        )
        return () => subscription.remove()
      },

      refreshInterval: 300_000,
    }),
  )

  return (
    <KlorProvider
      client={client}
      context={{
        // Whatever you target on stays on the device: it is never sent to Klor.
        userId: 'user-1',
        attributes: {
          platform: Platform.OS,
          country: 'US',
          // The installed binary's version, which is what gating is about. The
          // app config's version is baked into the JavaScript bundle, so after
          // an OTA update it can claim a version the native shell is not.
          appVersion: Application.nativeApplicationVersion ?? '0.0.0',
        },
      }}
    >
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#0b0a0f' } }} />
    </KlorProvider>
  )
}
