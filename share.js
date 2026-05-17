// api/share.js
// POST { slug } — increments the shares counter when someone copies a feed link.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { slug } = req.body ?? {};
  if (!slug) return res.status(400).json({ error: 'Missing slug.' });

  await supabase.rpc('increment_shares', { row_slug: slug });

  return res.status(200).json({ ok: true });
}
