// api/auth.js
// Register or login. Passwords arrive pre-hashed (SHA-256) from the client.
// No Supabase Auth — uses a plain `users` table.

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,30}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { username, password_hash, mode } = req.body ?? {};

  if (!username || !password_hash) return res.status(400).json({ error: 'Missing fields.' });
  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'Username must be 3–30 chars: letters, numbers, hyphens, underscores.' });
  if (!['login', 'register'].includes(mode)) return res.status(400).json({ error: 'Invalid mode.' });

  if (mode === 'register') {
    // check availability
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .ilike('username', username)
      .maybeSingle();

    if (existing) return res.status(409).json({ error: 'Username already taken.' });

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({ username, password_hash })
      .select('id, username')
      .single();

    if (error) {
      console.error('Register error:', error);
      return res.status(500).json({ error: 'Could not create account.' });
    }

    return res.status(200).json({ id: newUser.id, username: newUser.username });
  }

  // login
  const { data: user, error } = await supabase
    .from('users')
    .select('id, username, password_hash')
    .ilike('username', username)
    .maybeSingle();

  if (error || !user) return res.status(401).json({ error: 'Invalid username or password.' });
  if (user.password_hash !== password_hash) return res.status(401).json({ error: 'Invalid username or password.' });

  return res.status(200).json({ id: user.id, username: user.username });
}
