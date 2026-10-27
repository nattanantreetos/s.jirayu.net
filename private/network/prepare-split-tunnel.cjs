// Generate a private VPN profile locally without printing certificates or keys.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sources = ['D:/Downloads/seen.ovpn', 'D:/Downloads/seen - Copy.txt'];
const source = sources.find(file => fs.existsSync(file));
if (!source) throw new Error('Original VPN profile not found');
const original = fs.readFileSync(source, 'utf8');
const hash = crypto.createHash('sha256').update(original).digest('hex');
let inline = false;
const kept = [];
for (const line of original.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (/^<[^/][^>]*>$/.test(trimmed)) inline = true;
  if (inline || !/^(redirect-gateway|redirect-private|route|route-ipv6|route-nopull|pull-filter|dhcp-option|dns|block-outside-dns|block-ipv6)\b/.test(trimmed)) kept.push(line);
  if (/^<\/[^>]+>$/.test(trimmed)) inline = false;
}
if (inline) throw new Error('Unclosed inline credential block; original was not changed');
const destination = path.join(__dirname, 'seen-split-tunnel.ovpn');
const additions = [
  '# SEEN split tunnel: only the observed private server network uses VPN.',
  '# Internet/games use the normal connection. Original profile is unchanged.',
  'route-nopull',
  'route 10.3.0.0 255.255.0.0 vpn_gateway',
];
fs.writeFileSync(destination, kept.join('\r\n') + '\r\n' + additions.join('\r\n') + '\r\n', { flag: 'wx' });
if (crypto.createHash('sha256').update(fs.readFileSync(source, 'utf8')).digest('hex') !== hash) throw new Error('Original profile changed unexpectedly');
console.log('Created: ' + destination);
console.log('Original profile preserved. No connection or system route was changed.');
