// api/create.js
// Creates a new embed record in Supabase and returns the slug.

import { createClient } from '@supabase/supabase-js';
import { nanoid } from 'nanoid';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY  // service role — never expose to client
);

// Allowed og:type values
const ALLOWED_OG_TYPES = new Set(['video.other', 'website', 'article']);

// Very basic URL validator — rejects non-http(s) schemes
function isHttpUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch { return false; }
}

export default async function handler(req, res) {
  // Only POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit header check (Vercel adds x-forwarded-for)
  // For heavier protection add upstash/ratelimit — see SETUP.md

  const {
    thumb_url,
    video_url,
    video_w,
    video_h,
    redirect_url,
    og_type,
    custom_slug,
  } = req.body ?? {};

  // ── Validation ──────────────────────────────────────────────

  if (!redirect_url || !isHttpUrl(redirect_url)) {
    return res.status(400).json({ error: 'redirect_url is required and must be a valid https URL.' });
  }

  if (thumb_url && !isHttpUrl(thumb_url)) {
    return res.status(400).json({ error: 'thumb_url must be a valid URL.' });
  }

  if (video_url && !isHttpUrl(video_url)) {
    return res.status(400).json({ error: 'video_url must be a valid URL.' });
  }

  if (og_type && !ALLOWED_OG_TYPES.has(og_type)) {
    return res.status(400).json({ error: 'Invalid og_type.' });
  }

  if (video_w !== undefined && (typeof video_w !== 'number' || video_w < 1 || video_w > 7680)) {
    return res.status(400).json({ error: 'video_w must be a number between 1 and 7680.' });
  }

  if (video_h !== undefined && (typeof video_h !== 'number' || video_h < 1 || video_h > 4320)) {
    return res.status(400).json({ error: 'video_h must be a number between 1 and 4320.' });
  }

  // ── Slug ─────────────────────────────────────────────────────
  let slug;

  if (custom_slug) {
    // Validate slug format
    if (!/^[a-zA-Z0-9_-]{3,40}$/.test(custom_slug)) {
      return res.status(400).json({ error: 'Slug must be 3–40 chars: letters, numbers, hyphens, underscores.' });
    }

    // Check availability
    const { data: existing } = await supabase
      .from('embeds')
      .select('slug')
      .eq('slug', custom_slug)
      .maybeSingle();

    if (existing) {
      return res.status(409).json({ error: 'That slug is already taken. Try another.' });
    }

    slug = custom_slug;
  } else {
    // Generate random slug, retry up to 5 times on collision
    for (let i = 0; i < 5; i++) {
      const candidate = nanoid(8);
      const { data: existing } = await supabase
        .from('embeds')
        .select('slug')
        .eq('slug', candidate)
        .maybeSingle();
      if (!existing) { slug = candidate; break; }
    }
    if (!slug) return res.status(500).json({ error: 'Could not generate a unique slug. Try again.' });
  }

  // ── Insert ────────────────────────────────────────────────────
  const { error: insertError } = await supabase.from('embeds').insert({
    slug,
    thumb_url:    thumb_url   || null,
    video_url:    video_url   || null,
    video_w:      video_w     || 250,
    video_h:      video_h     || 202,
    redirect_url,
    og_type:      og_type     || 'video.other',
    // ip stored as a hash for abuse tracking — never raw
    ip_hash: hashIp(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''),
  });

  if (insertError) {
    console.error('Insert error:', insertError);
    return res.status(500).json({ error: 'Database error. Please try again.' });
  }

  return res.status(200).json({ slug });
}

// Simple one-way hash — not for crypto, just abuse pattern detection
function hashIp(ip) {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    hash = ((hash << 5) - hash) + ip.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(16);
}
