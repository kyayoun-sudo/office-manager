export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  future: {
    compatibilityVersion: 4,
  },
  ssr: false,
  components: [
    '~/components',
    {
      path: '~/pages',
      pattern: '**/components/**',
      pathPrefix: false,
    },
  ],
  devtools: { enabled: true },
  alias: {
    '~~/shared': './shared',
    '@@': '.',
    '~~': '.',
  },
  devServer: {
    port: 3000,
  },
  $production: {
    nitro: {
      preset: 'node-server',
    },
  },
  app: {
    head: {
      titleTemplate: '%s - Modèle d’administration',
      title: 'Home',
      meta: [
        { name: 'robots', content: 'noindex, nofollow, noarchive, nosnippet' },
        { name: 'googlebot', content: 'noindex, nofollow' },
        { name: 'bingbot', content: 'noindex, nofollow' },
      ],
    },
  },
  modules: [
    'shadcn-nuxt',
    '@pinia/nuxt',
    '@nuxtjs/tailwindcss',
    '@nuxtjs/color-mode',
    '@nuxt/icon',
    '@nuxt/eslint',
  ],
  colorMode: {
    classSuffix: '',
  },
  shadcn: {
    prefix: 'Ui',
    componentDir: './app/components/ui',
  },
  runtimeConfig: {
    apiKey: process.env.NUXT_API_KEY,
    apiBaseUrl: process.env.NUXT_API_BASE_URL || 'https://api.example.com/api',
    public: {
      encryptionKey: process.env.NUXT_PUBLIC_ENCRYPTION_KEY || '',
    },
  },
  nitro: {
    routeRules: {
      '/.well-known/**': { prerender: false },
      '/**': {
        headers: {
          'X-Robots-Tag': 'noindex, nofollow, noarchive, nosnippet',
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          'X-Permitted-Cross-Domain-Policies': 'none',
        },
      },
    },
  },
})
