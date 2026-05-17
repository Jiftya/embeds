// api/create.js
import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_OG_TYPES = new Set(['video.other', 'website', 'article']);

function isHttpUrl(str) {
  try { const u = new URL(str); return u.protocol === 'https:' || u.protocol === 'http:'; }
  catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const {
    thumb_url, video_url, video_w, video_h,
    redirect_url, og_type, custom_slug, title, user_id,
  } = req.body ?? {};

  if (!redirect_url || !isHttpUrl(redirect_url))
    return res.status(400).json({ error: 'redirect_url is required and must be a valid URL.' });
  if (thumb_url && !isHttpUrl(thumb_url))
    return res.status(400).json({ error: 'thumb_url must be a valid URL.' });
  if (video_url && !isHttpUrl(video_url))
    return res.status(400).json({ error: 'video_url must be a valid URL.' });
  if (og_type && !ALLOWED_OG_TYPES.has(og_type))
    return res.status(400).json({ error: 'Invalid og_type.' });
  if (video_w !== undefined && (typeof video_w !== 'number' || video_w < 1 || video_w > 7680))
    return res.status(400).json({ error: 'video_w must be between 1 and 7680.' });
  if (video_h !== undefined && (typeof video_h !== 'number' || video_h < 1 || video_h > 4320))
    return res.status(400).json({ error: 'video_h must be between 1 and 4320.' });
  if (title && title.length > 80)
    return res.status(400).json({ error: 'Title must be under 80 characters.' });

  let slug;
  if (custom_slug) {
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(custom_slug))
      return res.status(400).json({ error: 'Slug must be 3–40 chars: letters, numbers, hyphens, underscores.' });
    const { data: existing } = await supabase.from('embeds').select('slug').eq('slug', custom_slug).maybeSingle();
    if (existing) return res.status(409).json({ error: 'That slug is already taken.' });
    slug = custom_slug;
  } else {
    for (let i = 0; i < 5; i++) {
      const candidate = nanoid(8);
      const { data: existing } = await supabase.from('embeds').select('slug').eq('slug', candidate).maybeSingle();
      if (!existing) { slug = candidate; break; }
    }
    if (!slug) return res.status(500).json({ error: 'Could not generate a unique slug.' });
  }

  const { error: insertError } = await supabase.from('embeds').insert({
    slug,
    title:        title        || null,
    thumb_url:    thumb_url    || null,
    video_url:    video_url    || null,
    video_w:      video_w      || 250,
    video_h:      video_h      || 202,
    redirect_url,
    og_type:      og_type      || 'video.other',
    user_id:      user_id      || null,
    views:        0,
    shares:       0,
    ip_hash: hashIp(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''),
  });

  if (insertError) {
    console.error('Insert error:', insertError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }

  return res.status(200).json({ slug });
}

function hashIp(ip) {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) { hash = ((hash << 5) - hash) + ip.charCodeAt(i); hash |= 0; }
  return hash.toString(16);
}
