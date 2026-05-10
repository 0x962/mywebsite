import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const body = `User-agent: *
Allow: /

Sitemap: ${new URL('/sitemap-index.xml', context.site).toString()}
`;
  return new Response(body, { headers: { 'Content-Type': 'text/plain' } });
}
