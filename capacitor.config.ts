import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.ciji.wordtrail',
  appName: '词迹',
  webDir: 'dist',
  backgroundColor: '#f6f7fb',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
