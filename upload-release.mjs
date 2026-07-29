// Upload the packaged exe to the GitHub release matching package.json's version.
// Uses the GitHub token already stored by Git Credential Manager. Never prints it.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import https from 'node:https';

const OWNER = 'Riddim004';
const REPO = 'Endless-onslaught-Rogue';
const VERSION = JSON.parse(readFileSync('package.json', 'utf8')).version;
const TAG = `v${VERSION}`;
const EXE_PATH = `release/Endless Onslaught ${VERSION}.exe`;
const ASSET_NAME = `Endless-Onslaught-${VERSION}-win-x64.exe`;

// Pull the stored credential from Git Credential Manager.
const cred = execFileSync('git', ['credential', 'fill'], {
  input: 'protocol=https\nhost=github.com\n\n',
  encoding: 'utf8',
});
const token = cred.match(/^password=(.+)$/m)?.[1];
if (!token) {
  console.error('No stored GitHub credential found.');
  process.exit(1);
}

const baseHeaders = {
  Authorization: `Bearer ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'release-upload-script',
};

const api = (path, init = {}) =>
  fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { ...baseHeaders, ...(init.headers ?? {}) },
  });

// 1. Find or create the release for the tag.
let res = await api(`/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
let release;
if (res.status === 404) {
  res = await api(`/repos/${OWNER}/${REPO}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: TAG,
      name: TAG,
      body: `Endless Onslaught ${TAG}\n\n- \`${ASSET_NAME}\`: Windows portable, double-click to play (no install needed).`,
    }),
  });
  if (!res.ok) {
    console.error('Create release failed:', res.status, await res.text());
    process.exit(1);
  }
  release = await res.json();
  console.log('Release created:', release.html_url);
} else if (res.ok) {
  release = await res.json();
  console.log('Release exists:', release.html_url);
} else {
  console.error('Lookup failed:', res.status, await res.text());
  process.exit(1);
}

// 2. Remove any stale asset from a previously failed upload.
for (const a of release.assets ?? []) {
  if (a.name === ASSET_NAME) {
    const del = await api(`/repos/${OWNER}/${REPO}/releases/assets/${a.id}`, { method: 'DELETE' });
    console.log('Deleted stale asset, status:', del.status);
  }
}

// 3. Upload via node:https (no header/body timeout, works for slow uplinks).
const data = readFileSync(EXE_PATH);
const url = new URL(
  `https://uploads.github.com/repos/${OWNER}/${REPO}/releases/${release.id}/assets?name=${encodeURIComponent(ASSET_NAME)}`,
);

const upload = () =>
  new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'POST',
        headers: {
          ...baseHeaders,
          'Content-Type': 'application/octet-stream',
          'Content-Length': data.length,
        },
      },
      (resp) => {
        let body = '';
        resp.on('data', (c) => (body += c));
        resp.on('end', () => resolve({ status: resp.statusCode, body }));
      },
    );
    req.on('error', reject);
    let sent = 0;
    const chunkSize = 4 * 1024 * 1024;
    const writeNext = () => {
      while (sent < data.length) {
        const chunk = data.subarray(sent, sent + chunkSize);
        sent += chunk.length;
        process.stdout.write(`\rUploading... ${Math.round((sent / data.length) * 100)}%`);
        if (!req.write(chunk)) {
          req.once('drain', writeNext);
          return;
        }
      }
      process.stdout.write('\n');
      req.end();
    };
    writeNext();
  });

const { status, body } = await upload();
if (status !== 201) {
  console.error('Upload failed:', status, body);
  process.exit(1);
}
console.log('Asset uploaded:', JSON.parse(body).browser_download_url);
