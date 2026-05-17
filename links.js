// api/links.js
// GET /api/links?sort=trending|new        → public feed
// GET /api/links?user_id=xxx              → user's own links

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { sort, user_id } = req.query;

  let query = supabase
    .from('embeds')
    .select('slug, title, thumb_url, redirect_url, views, shares, created_at, user_id')
    .limit(50);

  if (user_id) {
    query = query.eq('user_id', user_id).order('created_at', { ascending: false });
  } else if (sort === 'trending') {
    query = query.order('views', { ascending: false });
  } else {
    query = query.order('created_at', { ascending: false });
  }

  const { data, error } = await query;

  if (error) {
    console.error('Links fetch error:', error);
    return res.status(500).json({ error: 'Could not fetch links.' });
  }

  return res.status(200).json({ links: data });
}
