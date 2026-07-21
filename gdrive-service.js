// ── Google Drive — Service Account (mismo patrón que app PGP) ─────────────
// Requiere variable de entorno: GOOGLE_SERVICE_ACCOUNT_JSON
// Carpeta fija: GDRIVE_FOLDER_ID (env) o la hardcoded abajo
const { google } = require('googleapis');
const { Readable } = require('stream');

const ROOT_FOLDER_ID = process.env.GDRIVE_FOLDER_ID || '1GvJuv9M4tssWIKwI9gA5TyUqFLigLIQc';

function getAuth() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw || raw === 'PENDIENTE') {
    throw new Error(
      'Drive no configurado. Agrega GOOGLE_SERVICE_ACCOUNT_JSON en las variables de entorno de Vercel.'
    );
  }
  return new google.auth.GoogleAuth({
    credentials: JSON.parse(raw),
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
}

function getDrive() {
  return google.drive({ version: 'v3', auth: getAuth() });
}

const _folderCache = {};

async function getOrCreateSubfolder(drive, parentId, name) {
  const k = `${parentId}|${name}`;
  if (_folderCache[k]) return _folderCache[k];

  const res = await drive.files.list({
    q: `'${parentId}' in parents and name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)',
  });
  if (res.data.files?.length) {
    _folderCache[k] = res.data.files[0].id;
    return _folderCache[k];
  }
  const f = await drive.files.create({
    requestBody: { name, mimeType: 'application/vnd.google-apps.folder', parents: [parentId] },
    fields: 'id',
  });
  _folderCache[k] = f.data.id;
  return _folderCache[k];
}

async function findFileId(drive, folderId, name) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name='${name}' and trashed=false`,
    fields: 'files(id,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 1,
  });
  return res.data.files?.[0]?.id ?? null;
}

// Escribe (crea o reemplaza) un archivo en Drive
async function writeFile(folderId, name, content, mimeType = 'application/json') {
  const drive = getDrive();
  const body  = Readable.from([Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')]);
  const existing = await findFileId(drive, folderId, name);

  if (existing) {
    await drive.files.update({
      fileId: existing,
      media: { mimeType, body },
    });
    return { id: existing, updated: true };
  }
  const res = await drive.files.create({
    requestBody: { name, parents: [folderId], mimeType },
    media: { mimeType, body },
    fields: 'id',
  });
  return { id: res.data.id, updated: false };
}

// Lee el contenido de un archivo en Drive
async function readFile(folderId, name) {
  const drive = getDrive();
  const id    = await findFileId(drive, folderId, name);
  if (!id) return null;

  const res = await drive.files.get(
    { fileId: id, alt: 'media' },
    { responseType: 'arraybuffer' }
  );
  return Buffer.from(res.data).toString('utf-8');
}

// Lista archivos en una carpeta
async function listFiles(folderId) {
  const drive = getDrive();
  const res   = await drive.files.list({
    q: `'${folderId}' in parents and trashed=false`,
    fields: 'files(id,name,modifiedTime,size)',
    pageSize: 200,
    orderBy: 'modifiedTime desc',
  });
  return res.data.files ?? [];
}

// Verificar si el service account está configurado
function isConfigured() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  return !!(raw && raw !== 'PENDIENTE' && raw.trim().startsWith('{'));
}

module.exports = { ROOT_FOLDER_ID, getDrive, getOrCreateSubfolder, writeFile, readFile, listFiles, isConfigured };
