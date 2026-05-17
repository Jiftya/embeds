// api/delete.js
// POST { slug, user_id } — deletes an embed row only if user_id matches.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug, user_id } = req.body ?? {};
  if (!slug || !user_id) return res.status(400).json({ error: 'Missing fields.' });

  // Verify ownership first
  const { data, error: fetchErr } = await supabase
    .from('embeds')
    .select('user_id')
    .eq('slug', slug)
    .maybeSingle();

  if (fetchErr || !data) return res.status(404).json({ error: 'Link not found.' });
  if (data.user_id !== user_id) return res.status(403).json({ error: 'Not your link.' });

  const { error } = await supabase.from('embeds').delete().eq('slug', slug);
  if (error) return res.status(500).json({ error: 'Delete failed.' });

  return res.status(200).json({ ok: true });
}
