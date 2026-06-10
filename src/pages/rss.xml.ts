// SSR so publish toggles apply without a rebuild.
export const prerender = false;

import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { publishedPosts, readAllPosts } from '../lib/posts';

export async function GET(context: APIContext) {
  const posts = publishedPosts(await readAllPosts(context.locals.runtime.env.POSTS));

  return rss({
    title: 'Navid Khan — WIP',
    description: 'Work-in-progress notes, essays, and rough drafts by Navid Khan.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.title,
      pubDate: new Date(post.createdAt),
      description: post.summary,
      link: `/post/${post.slug}/`,
    })),
    customData: `<language>en-us</language>`,
  });
}
