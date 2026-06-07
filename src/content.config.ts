import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    sha: z.string().optional(),
    draft: z.boolean().optional().default(false),
    /** Canvas posts authored in Excalidraw (page served by a dedicated .astro). */
    canvas: z.enum(['excalidraw']).optional(),
  }),
});

export const collections = { posts };
