import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so a production build can be served from any subpath.
  base: './',
  server: {
    open: true,
  },
});
