// api/v/[slug].js
// Looks up an embed by slug and returns the OG embed HTML.
// This is what Discord (and browsers) hit when someone shares the link.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Slug format guard
const SLUG_RE = /^[a-zA-Z0-9_-]{3,40}$/;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).send('Method not allowed');
  }

  const { slug } = req.query;

  if (!slug || !SLUG_RE.test(slug)) {
    return res.status(404).send('Not found');
  }

  // Fetch embed record
  const { data, error } = await supabase
    .from('embeds')
    .select('thumb_url, video_url, video_w, video_h, redirect_url, og_type')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) {
    return res.status(404).send('Embed not found');
  }

  // Optionally bump a view counter (non-blocking)
  supabase.from('embeds').update({ views: supabase.raw('views + 1') }).eq('slug', slug).then(() => {});

  const {
    thumb_url,
    video_url,
    video_w,
    video_h,
    redirect_url,
    og_type,
  } = data;

  // Build HTML — all values come from DB (already validated on insert)
  const html = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="UTF-8">
    ${thumb_url ? `<meta property="og:image" content="${esc(thumb_url)}">` : ''}
    <meta property="og:type" content="${esc(og_type)}">
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
  // Cache for 5 minutes — Discord bots cache embeds aggressively
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.status(200).send(html);
}

// Escape HTML special chars in attribute values
function esc(str) {
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/"/g,  '&quot;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;');
}
