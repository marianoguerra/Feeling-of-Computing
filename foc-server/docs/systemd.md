# Deploying foc-server under systemd (Ubuntu)

End-to-end recipe for running `foc-server` as a systemd service behind
nginx. Targets Ubuntu 22.04/24.04; anything with systemd ≥ 247 works.

The sample unit file is at `resources/foc-server.service`. Read the
header of that file — it tells you exactly which lines to change.

---

## 1. Recommended filesystem layout

| Path                                     | Owner       | Mode | What lives here                              |
| ---------------------------------------- | ----------- | ---- | -------------------------------------------- |
| `/usr/local/bin/foc-server`              | `root:root` | 0755 | Compiled binary                              |
| `/etc/foc-server/config.toml`            | `root:foc`  | 0640 | Production config                            |
| `/etc/systemd/system/foc-server.service` | `root:root` | 0644 | The unit file                                |
| `/var/lib/foc-server/db_data/`           | `foc:foc`   | 0750 | LanceDB tables (persistent state)            |
| `/var/lib/foc-server/history/`           | `foc:foc`   | 0750 | Source JSON used to build the index          |
| `/var/cache/foc-server/huggingface/`     | `foc:foc`   | 0750 | Pre-downloaded embedding model (`HF_HOME`)   |
| `/etc/nginx/sites-available/foc-server`  | `root:root` | 0644 | Reverse proxy config                         |

The binary is the only thing in `/usr/local/bin`. Everything stateful
is under `/var/lib/foc-server` or `/var/cache/foc-server`, which are the
only directories listed in `ReadWritePaths=` — everything else on the
system is read-only to the service thanks to `ProtectSystem=strict`.

---

## 2. One-time setup

### Service user

```sh
sudo adduser --system --group --home /var/lib/foc-server \
             --shell /usr/sbin/nologin foc
```

### Directories & permissions

```sh
sudo install -d -o foc -g foc -m 0750 /var/lib/foc-server/db_data
sudo install -d -o foc -g foc -m 0750 /var/lib/foc-server/history
sudo install -d -o foc -g foc -m 0750 /var/cache/foc-server/huggingface
sudo install -d -o root -g foc -m 0750 /etc/foc-server
```

### Binary

Build on the target host (simplest, avoids glibc/libstdc++ skew):

```sh
# on the server, as your normal user
curl https://sh.rustup.rs -sSf | sh
sudo apt install -y build-essential pkg-config
git clone <repo> && cd foc-server
cargo build --release
sudo install -m 0755 target/release/foc-server /usr/local/bin/foc-server
```

### Config

Copy `config.example.toml` to `/etc/foc-server/config.toml` and edit.
At minimum:

```toml
[server]
bind = "127.0.0.1:3000"   # keep loopback; nginx is the internet edge

[database]
path = "/var/lib/foc-server/db_data"   # MUST be absolute
table = "messages"
fts_column = "thread_text"
vector_column = "vector"
exclude_columns = ["vector", "thread_text"]

[embedding]
model = "all-MiniLM-L6-v2"
ndims = 384
normalize = true
```

Then lock it down and validate:

```sh
sudo chown root:foc /etc/foc-server/config.toml
sudo chmod 0640 /etc/foc-server/config.toml
sudo /usr/local/bin/foc-server check /etc/foc-server/config.toml
```

`check` exits non-zero on any error (relative paths, bind on 0.0.0.0,
vector column missing from `exclude_columns`, etc.). The unit file runs
it as `ExecStartPre` so a broken config refuses to start.

### Pre-download the embedding model

`foc-server serve` sets `HF_HUB_OFFLINE=1` and refuses to hit the
network. The cache must be populated once, as the service user, so
permissions match what systemd will use at runtime:

```sh
sudo -u foc HF_HOME=/var/cache/foc-server/huggingface \
  /usr/local/bin/foc-server fetch-model /etc/foc-server/config.toml
```

Rerun this whenever you change `embedding.model` or `embedding.revision`.

### Install the unit

```sh
sudo install -m 0644 resources/foc-server.service \
  /etc/systemd/system/foc-server.service
sudo systemctl daemon-reload
sudo systemctl enable --now foc-server
```

Verify:

```sh
systemctl status foc-server
curl -fsS http://127.0.0.1:3000/health   # → ok
journalctl -u foc-server -n 50
```

---

## 3. Managing the service

| Task                                 | Command                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| Status + last 10 log lines           | `systemctl status foc-server`                              |
| Start / stop / restart               | `sudo systemctl {start,stop,restart} foc-server`           |
| Enable at boot / disable             | `sudo systemctl {enable,disable} foc-server`               |
| Reload config (requires restart)     | `sudo systemctl restart foc-server`                        |
| Validate config without restarting   | `sudo /usr/local/bin/foc-server check /etc/foc-server/config.toml` |
| Tail logs (follow)                   | `journalctl -u foc-server -f`                              |
| Logs since last boot                 | `journalctl -u foc-server -b`                              |
| Logs in a window                     | `journalctl -u foc-server --since "10 min ago"`            |
| Only warnings and above              | `journalctl -u foc-server -p warning`                      |
| Audit sandbox score                  | `systemd-analyze security foc-server`                      |
| Show effective unit file             | `systemctl cat foc-server`                                 |
| Show resolved directives + overrides | `systemctl show foc-server`                                |

### Upgrading the binary

```sh
cargo build --release
sudo install -m 0755 target/release/foc-server /usr/local/bin/foc-server
sudo /usr/local/bin/foc-server check /etc/foc-server/config.toml
sudo systemctl restart foc-server
```

Graceful shutdown is wired up, so `restart` drains in-flight requests
up to `TimeoutStopSec` (15s by default). If clients see connection
resets during restart, extend `TimeoutStopSec` in the unit file.

---

## 4. Debugging

### Startup failures

```sh
journalctl -u foc-server -n 100 --no-pager
```

Common messages:

| Symptom in log                                                    | Cause                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `failed to start server — if this is a model-loading error, run…` | Embedding model not cached → rerun `fetch-model` as the `foc` user |
| `No such file or directory (os error 2)` on config path            | Wrong path in `ExecStart=` or file not readable by `foc`          |
| `Permission denied` writing db_data                                | Directory not owned by `foc`, or missing from `ReadWritePaths=`   |
| `Address already in use`                                           | Another process on the bind port (`ss -lntp`)                     |
| `error: config has N error(s)` from ExecStartPre                   | `foc-server check` failed — fix the reported issues               |

### Runtime problems

Per-request logs come from the `TraceLayer`. Each line carries the
request id (header `x-request-id`, UUID v4) so users can give you a
correlation token:

```sh
journalctl -u foc-server | grep <request-id>
```

Raw rate-limit and body-limit rejections show up at `info` in
`foc_server::error`. Server errors (5xx) log full error chains at
`error` level.

**Do not set `RUST_LOG=debug` in production.** The default filter
scopes debug to this crate; a bare `debug` would make `lancedb`,
`hyper`, and `tower_governor` log full request payloads, leaking user
queries to the journal. Safe production knob:

```
RUST_LOG=foc_server=debug
```

### Sandbox trips

If a legitimate feature starts failing after an upgrade, check:

```sh
journalctl -u foc-server | grep -iE 'denied|operation not permitted|no such device'
```

The fix is almost always to loosen ONE directive in the unit (e.g. add
a path to `ReadWritePaths=`), not to strip the whole hardening block.

---

## 5. nginx reverse proxy

foc-server expects to sit behind a reverse proxy. Nothing in the
process handles TLS or CORS.

### Install

```sh
sudo apt install -y nginx
sudo ufw allow 'Nginx Full'   # opens 80 + 443
```

### Site file — `/etc/nginx/sites-available/foc-server`

```nginx
# Rate-limit zone: a coarse first line of defense before the per-process
# tower_governor. 10MB holds ~160k unique IPs.
limit_req_zone $binary_remote_addr zone=foc_api:10m rate=20r/s;

server {
    listen 80;
    listen [::]:80;
    server_name search.example.com;

    # certbot will inject the redirect-to-https after it runs.
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name search.example.com;

    # certbot will fill these in.
    # ssl_certificate     /etc/letsencrypt/live/search.example.com/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/search.example.com/privkey.pem;

    # Hide nginx version in error pages + Server header.
    server_tokens off;

    # Upload size guardrail (server enforces 4 KiB on /search/*; keep a
    # little slack so clients get a clean 413 instead of connection reset).
    client_max_body_size 8k;
    client_body_timeout  15s;

    access_log /var/log/nginx/foc-server.access.log;
    error_log  /var/log/nginx/foc-server.error.log warn;

    location = /health {
        # Health stays outside the rate limit.
        proxy_pass http://127.0.0.1:3000;
        access_log off;
    }

    location / {
        limit_req zone=foc_api burst=40 nodelay;
        limit_req_status 429;

        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;

        # Upstream needs the real client IP for tower_governor's
        # SmartIpKeyExtractor and for log lines.
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Propagate request ids both ways. foc-server mints one if the
        # header is absent; passing it upstream lets callers correlate.
        proxy_set_header X-Request-Id      $request_id;

        # Server-side per-request timeout is 30s; give a few seconds of
        # slack so the client sees the app's 408, not nginx's 504.
        proxy_read_timeout  35s;
        proxy_send_timeout  35s;
        proxy_connect_timeout 5s;
    }
}
```

Activate:

```sh
sudo ln -s /etc/nginx/sites-available/foc-server /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
sudo certbot --nginx -d search.example.com
```

### Why bind on loopback + trust XFF

`foc-server` uses `tower_governor`'s `SmartIpKeyExtractor`, which reads
`X-Forwarded-For` / `X-Real-IP` for the per-IP rate-limit bucket. That
header is only safe to trust when the *only* peers that can reach the
process are trusted proxies. Binding on `127.0.0.1` enforces that:
random clients on the internet can't open a TCP connection to port
3000, so they can't forge an XFF header either. If you ever change
`server.bind` to a non-loopback address, revisit this — a public bind
turns XFF trust into a rate-limit bypass.

`foc-server check` will flag a non-loopback bind.

### nginx debugging

| Task                                             | Command                                                       |
| ------------------------------------------------ | ------------------------------------------------------------- |
| Validate config before reload                    | `sudo nginx -t`                                               |
| Reload without dropping connections              | `sudo systemctl reload nginx`                                 |
| Tail access logs                                 | `sudo tail -f /var/log/nginx/foc-server.access.log`           |
| Tail error logs                                  | `sudo tail -f /var/log/nginx/foc-server.error.log`            |
| Confirm upstream is healthy from the box itself  | `curl -fsS http://127.0.0.1:3000/health`                      |
| Confirm nginx sees upstream                       | `curl -fsS -H 'Host: search.example.com' http://127.0.0.1/health` |
| Which process holds a port                       | `sudo ss -lntp \| grep -E ':3000\|:443'`                       |
| Check effective TLS                               | `curl -vI https://search.example.com/health 2>&1 \| head -30` |
| Are rate limits firing?                           | `grep 'limiting requests' /var/log/nginx/error.log`           |

If logs show `upstream prematurely closed connection`, check
`journalctl -u foc-server` — the app likely crashed or timed out. If
the app log is quiet, the request exceeded the 4 KiB body limit and
axum closed the stream; nginx's 413 would be cleaner — tighten
`client_max_body_size` to match.

---

## 6. Backups

Only `/var/lib/foc-server` holds state you can't regenerate cheaply.
A nightly tarball of `db_data/` + `history/` is enough:

```sh
# /etc/cron.daily/foc-server-backup
#!/bin/sh
set -eu
ts=$(date -u +%Y%m%dT%H%M%SZ)
tar -C /var/lib/foc-server -czf /var/backups/foc-server-$ts.tar.gz db_data history
find /var/backups -name 'foc-server-*.tar.gz' -mtime +14 -delete
```

Off-host replication (rclone to S3 / Backblaze / Wasabi) is left as an
exercise; the tarballs are opaque blobs and safe to ship.
