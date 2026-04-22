SYNC TEMPLE
===========

Server: https://sync.0xxi.cloud
Token:  <your-token-here>

Two channels (A and B), both bidirectional. Drop a whole folder —
only changed files get uploaded. Live updates via SSE.


SETUP (local mac)
-----------------

Add to ~/.zshrc:

  export SYNC_TEMPLE_URL=https://sync.0xxi.cloud
  export SYNC_TEMPLE_TOKEN=<your-token-here>
  alias st='/Users/olli/schenanigans/sync_temple/sync'


CLI
---

  st push a ./dir          upload changed files to channel A
  st pull a ./dir          download changed files from channel A
  st push a ./dir --sync   push + delete server files you removed locally
  st pull a ./dir --sync   pull + delete local files not on server
  st text-push b < file    upload text/logs to channel B
  st text-pull b           print channel B text to stdout
  st files a               list files in channel A
  st clear a -y            wipe channel A


WEB UI (work machine)
---------------------

Open https://sync.0xxi.cloud in browser, enter token.
Drop project folder onto a channel. Download as ZIP.
Text areas for quick log/note exchange.


TYPICAL LOOP
------------

Work machine:  code with Copilot -> drop folder on channel A
Local machine:  st pull a ./project && ./run.sh 2>&1 | st text-push b
Work machine:  check channel B text for output -> iterate


INFRA
-----

FreeBSD jail "sync" at 127.0.1.7:8787 on vpstracker.
Caddy reverse proxies sync.0xxi.cloud -> jail.
Cloudflare proxy ON (handles public TLS).
Binary: /usr/local/bin/sync-temple inside jail.
Service: bastille service sync sync_temple restart
Data:    /var/db/sync_temple inside jail.
