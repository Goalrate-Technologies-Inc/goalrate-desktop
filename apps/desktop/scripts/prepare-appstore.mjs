import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, '..');
const tauriRoot = resolve(appRoot, 'src-tauri');
const tauriConfigPath = resolve(tauriRoot, 'tauri.conf.json');
const entitlementsPath = resolve(tauriRoot, 'Entitlements.appstore.plist');
const embeddedProfilePath = resolve(tauriRoot, 'embedded.provisionprofile');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for Mac App Store builds.`);
  }
  return value;
}

function xmlEscape(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

const teamId = requiredEnv('APPLE_TEAM_ID');
const provisioningProfile = requiredEnv('APPLE_PROVISIONING_PROFILE');
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
const identifier = tauriConfig.identifier;

if (!identifier) {
  throw new Error('tauri.conf.json must define an identifier for App Store builds.');
}

const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.application-identifier</key>
  <string>${xmlEscape(teamId)}.${xmlEscape(identifier)}</string>
  <key>com.apple.developer.team-identifier</key>
  <string>${xmlEscape(teamId)}</string>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-write</key>
  <true/>
  <key>com.apple.security.files.bookmarks.app-scope</key>
  <true/>
</dict>
</plist>
`;

mkdirSync(tauriRoot, { recursive: true });
writeFileSync(entitlementsPath, entitlements);
copyFileSync(resolve(provisioningProfile), embeddedProfilePath);

console.log(`Prepared Mac App Store entitlements for ${teamId}.${identifier}`);
