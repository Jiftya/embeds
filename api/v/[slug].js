// api/v/[slug].js
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SLUG_RE = /^[a-zA-Z0-9_-]{3,40}$/;

const SITE_URL = process.env.SITE_URL || 'http://vlink.lol'; // set this in Vercel env vars

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { slug } = req.query;

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(404).send('Not found');
  }

  const { data, error } = await supabase
    .from('embeds')
    .select('thumb_url, video_url, video_w, video_h, redirect_url, og_type')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).send('Embed not found');
  }

  supabase.rpc('increment_views', { row_slug: slug }).then(() => {});

  const { thumb_url, video_url, video_w, video_h, redirect_url, og_type } = data;

  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    ${thumb_url ? `<meta property="og:image" content="${esc(thumb_url)}">` : ''}
    <meta property="og:type"        content="${esc(og_type)}">
    <meta property="og:url"         content="${esc(SITE_URL)}">
    <meta property="og:site_name"   content="vlink">
    <meta property="og:description" content="made with vlink — ${esc(SITE_URL)}">
    ${video_url ? `
    <meta property="og:video:url"    content="${esc(video_url)}">
    <meta property="og:video:width"  content="${video_w}">
    <meta property="og:video:height" content="${video_h}">` : ''}
    <meta http-equiv="refresh" content="0; url=${esc(redirect_url)}" />
    <title>vlink</title>
  </head>
  <body>
    <p>Redirecting… <a href="${esc(redirect_url)}">click here if not redirected</a></p>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.status(200).send(html);
}

function esc(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}
