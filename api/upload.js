// api/upload.js
// Receives a file upload, validates it, and stores it in Supabase Storage.
// Returns the public URL.

import { createClient } from '@supabase/supabase-js';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: false }, // required for formidable
};

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Allowed MIME types and their extensions
const ALLOWED_THUMB = {
  'image/jpeg':   'jpg',
  'image/png':    'png',
  'image/gif':    'gif',
  'image/webp':   'webp',
};

const ALLOWED_VIDEO = {
  'video/mp4':    'mp4',
  'video/webm':   'webm',
};

const MAX_THUMB_BYTES = 8  * 1024 * 1024;  //  8 MB
const MAX_VIDEO_BYTES = 50 * 1024 * 1024;  // 50 MB

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse multipart form
  const form = formidable({
    maxFileSize: MAX_VIDEO_BYTES + 1024, // slight headroom; we re-check below
    keepExtensions: false,
  });

  let fields, files;
  try {
    [fields, files] = await form.parse(req);
  } catch (err) {
    return res.status(400).json({ error: 'Could not parse upload. File may be too large.' });
  }

  const type = Array.isArray(fields.type) ? fields.type[0] : fields.type;
  const file = Array.isArray(files.file) ? files.file[0] : files.file;

  if (!file) return res.status(400).json({ error: 'No file received.' });
  if (!type || !['thumb', 'video'].includes(type)) {
    return res.status(400).json({ error: 'Invalid upload type.' });
  }

  // ── MIME check (magic bytes, not just header) ─────────────────
  const mime = await detectMime(file.filepath);

  if (type === 'thumb') {
    if (!ALLOWED_THUMB[mime]) {
      return res.status(400).json({ error: 'Thumbnail must be JPEG, PNG, GIF, or WebP.' });
    }
    if (file.size > MAX_THUMB_BYTES) {
      return res.status(400).json({ error: 'Thumbnail must be under 8 MB.' });
    }
  } else {
    if (!ALLOWED_VIDEO[mime]) {
      return res.status(400).json({ error: 'Video must be MP4 or WebM.' });
    }
    if (file.size > MAX_VIDEO_BYTES) {
      return res.status(400).json({ error: 'Video must be under 50 MB.' });
    }
  }

  // ── Build a safe storage path ─────────────────────────────────
  // Random name — never use user-supplied filenames
  const ext    = type === 'thumb' ? ALLOWED_THUMB[mime] : ALLOWED_VIDEO[mime];
  const bucket = type === 'thumb' ? 'thumbs' : 'videos';
  const name   = crypto.randomBytes(16).toString('hex') + '.' + ext;
  const storagePath = name; // flat bucket, no subfolders needed

  // ── Upload to Supabase Storage ────────────────────────────────
  const fileBuffer = fs.readFileSync(file.filepath);

  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, fileBuffer, {
      contentType: mime,
      upsert: false,
    });

  // Clean up temp file
  fs.unlinkSync(file.filepath);

  if (uploadError) {
    console.error('Storage upload error:', uploadError);
    return res.status(500).json({ error: 'Storage upload failed. Try again.' });
  }

  // ── Get public URL ────────────────────────────────────────────
  const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(storagePath);

  return res.status(200).json({ url: urlData.publicUrl });
}

// ── Magic byte MIME detection ─────────────────────────────────
// Reads first 12 bytes to verify actual file type
async function detectMime(filepath) {
  const fd  = fs.openSync(filepath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);

  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  // PNG
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  // GIF
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'image/gif';
  // WebP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return 'image/webp';
  // MP4 (ftyp box at byte 4)
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return 'video/mp4';
  // WebM (EBML header)
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';

  return 'application/octet-stream'; // unknown → will be rejected
}
