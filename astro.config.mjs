import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://casaluzfilms.com',
  output: 'static',
  integrations: [sitemap()],
});
