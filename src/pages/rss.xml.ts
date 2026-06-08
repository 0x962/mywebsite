// SSR so KV publish overrides apply without a rebuild.
export const prerender = false;

import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { readManyOverrides } from '../lib/scenes';

export async function GET(context: APIContext) {
  const all = await getCollection('posts');
  const slugs = all.map((p) => p.id.replace(/\.mdx?$/, ''));
  const overrides = await readManyOverrides(context.locals.runtime.env.SCENES, slugs);

  const posts = all
    .filter((p) => {
      const slug = p.id.replace(/\.mdx?$/, '');
      const ov = overrides[slug];
      return ov ? ov.published : !p.data.draft;
    })
    .sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());

  return rss({
    title: 'Navid Khan — WIP',
    description: 'Work-in-progress notes, essays, and rough drafts by Navid Khan.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      link: `/wip/${post.id.replace(/\.mdx?$/, '')}/`,
    })),
    customData: `<language>en-us</language>`,
  });
}
