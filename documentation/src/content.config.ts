import { defineCollection } from 'astro:content';
import { docsLoader } from '@astrojs/starlight/loaders';
import { docsSchema } from '@astrojs/starlight/schema';
import { z } from 'astro/zod';

// M5 S13: `since` marks a page new in a release, `updated` one that changed; the
// sidebar badges and the build's release check read them (src/lib/release.mjs).
const version = z.string().regex(/^\d+\.\d+\.\d+$/, 'a version like 1.2.0');

export const collections = {
  docs: defineCollection({
    loader: docsLoader(),
    schema: docsSchema({ extend: z.object({ since: version.optional(), updated: version.optional() }) }),
  }),
};
