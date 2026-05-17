// api/upload.js
import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: false },
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_THUMB = {
  'image/jpeg': 'jpg',
  'image/png':  'png',
  'image/gif':  'gif',
  'image/webp': 'webp',
};

const ALLOWED_VIDEO = {
  'video/mp4':  'mp4',
  'video/webm': 'webm',
};

const MAX_THUMB = 8  * 1024 * 1024;  //  8 MB
const MAX_VIDEO = 50 * 1024 * 1024;  // 50 MB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase env vars');
    return res.status(500).json({ error: 'Server misconfigured — missing env vars.' });
  }

  // Parse multipart — formidable v3
  const form = formidable({
    maxFileSize: MAX_VIDEO + 1024,
    uploadDir: '/tmp',
    keepExtensions: false,
  });

  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    console.error('Formidable parse error:', err);
    return res.status(400).json({ error: 'Upload parse failed. File may be too large or malformed.' });
  }

  const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
  const file = Array.isArray(files.file) ? files.file[0] : files.file;

  if (!file) return res.status(400).json({ error: 'No file received.' });
  if (!type || !['thumb', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Invalid upload type.' });
  }

  const filepath = file.filepath;

  // File size check
  const maxSize = type === 'thumb' ? MAX_THUMB : MAX_VIDEO;
  if (file.size > maxSize) {
    try { fs.unlinkSync(filepath); } catch {}
    return res.status(400).json({
      error: type === 'thumb' ? 'Thumbnail must be under 8 MB.' : 'Video must be under 50 MB.',
    });
  }

  // Magic byte MIME detection
  let mime;
  try {
    mime = detectMime(filepath);
  } catch (err) {
    console.error('MIME detection error:', err);
    try { fs.unlinkSync(filepath); } catch {}
    return res.status(400).json({ error: 'Could not read file.' });
  }

  const allowed = type === 'thumb' ? ALLOWED_THUMB : ALLOWED_VIDEO;
  if (!allowed[mime]) {
    try { fs.unlinkSync(filepath); } catch {}
    return res.status(400).json({
      error: type === 'thumb'
        ? 'Thumbnail must be a JPEG, PNG, GIF, or WebP.'
        : 'Video must be MP4 or WebM.',
    });
  }

  // Upload to Supabase Storage
  const ext    = allowed[mime];
  const bucket = type === 'thumb' ? 'thumbs' : 'videos';
  const name   = crypto.randomBytes(16).toString('hex') + '.' + ext;

  let fileBuffer;
  try {
    fileBuffer = fs.readFileSync(filepath);
  } catch (err) {
    console.error('File read error:', err);
    return res.status(500).json({ error: 'Could not read uploaded file.' });
  } finally {
    try { fs.unlinkSync(filepath); } catch {}
  }

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(name, fileBuffer, {
      contentType: mime,
      upsert: false,
    });

  if (uploadError) {
    console.error('Supabase storage error:', JSON.stringify(uploadError));
    return res.status(500).json({ error: 'Storage upload failed: ' + uploadError.message });
  }

  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(name);

  return res.status(200).json({ url: urlData.publicUrl });
}

function detectMime(filepath) {
  const fd  = fs.openSync(filepath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';

  return 'application/octet-stream';
}
