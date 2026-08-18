# Deploy OpenDM on Ubuntu with Docker Compose

This guide assumes Docker Engine, the Docker Compose plugin, Git, and OpenSSL
are already installed. It covers the application startup only. The server must
also have a public domain with HTTPS forwarding to OpenDM on port `3000` before
Meta OAuth and webhooks can work.

## 1. Clone the production branch

Deploy `main` after the release pull request has been merged. Do not point a
production server at a feature branch.

```bash
sudo mkdir -p /opt/opendm
sudo chown "$USER":"$USER" /opt/opendm
git clone --branch main --single-branch \
  https://github.com/diegoluppi1993/opendm.git /opt/opendm
cd /opt/opendm
```

## 2. Generate the local secrets

Run these commands on the Ubuntu server. Save each result temporarily and put
it in the matching `.env` variable in the next step.

```bash
# NEXTAUTH_SECRET
openssl rand -base64 32

# CRON_SECRET
openssl rand -base64 32

# ENCRYPTION_KEY (must be exactly 64 hexadecimal characters)
openssl rand -hex 32

# WEBHOOK_VERIFY_TOKEN
openssl rand -hex 32

# POSTGRES_PASSWORD (hex avoids characters that need URL encoding)
openssl rand -hex 24
```

Never reuse these values between unrelated installations. In particular,
`ENCRYPTION_KEY` must remain unchanged after Instagram accounts are connected:
changing or losing it makes every stored access token unreadable.

## 3. Collect the external credentials

All three Meta values come from **one Meta app**:

| Variable | Where to find it |
| --- | --- |
| `INSTAGRAM_APP_ID` | Meta app dashboard, Instagram, API setup with Instagram Login |
| `INSTAGRAM_APP_SECRET` | The same Instagram Login setup page, click **Show** |
| `FACEBOOK_APP_SECRET` | Meta app dashboard, App settings, Basic, App secret |

For email magic links, create a Resend API key and verify the domain used by
`EMAIL_FROM`:

| Variable | Example |
| --- | --- |
| `RESEND_API_KEY` | `re_...` from the Resend dashboard |
| `EMAIL_FROM` | `OpenDM <login@example.com>` on a verified domain |

If you use your own SMTP server instead, set `EMAIL_SERVER` to its SMTP URL and
leave `RESEND_API_KEY` empty.

## 4. Create the production environment file

Create the file with restrictive permissions:

```bash
cd /opt/opendm
umask 077
touch .env
nano .env
```

Paste this template and replace every value marked `CHANGE_ME`:

```dotenv
# Public application URL — HTTPS, no trailing slash
NEXTAUTH_URL=https://opendm.example.com

# Values generated with OpenSSL in step 2
NEXTAUTH_SECRET=CHANGE_ME
CRON_SECRET=CHANGE_ME
ENCRYPTION_KEY=CHANGE_ME
WEBHOOK_VERIFY_TOKEN=CHANGE_ME

# Internal PostgreSQL container
POSTGRES_DB=opendm
POSTGRES_USER=opendm
POSTGRES_PASSWORD=CHANGE_ME

# Optional host ports
APP_PORT=3000
POSTGRES_PORT=5432
REDIS_PORT=6379

# Email magic links
RESEND_API_KEY=CHANGE_ME
EMAIL_FROM=OpenDM <login@example.com>
# EMAIL_SERVER=smtps://user:password@mail.example.com:465

# Meta / Instagram — all from the same Meta app
META_GRAPH_API_VERSION=v25.0
INSTAGRAM_APP_ID=CHANGE_ME
INSTAGRAM_APP_SECRET=CHANGE_ME
FACEBOOK_APP_SECRET=CHANGE_ME
```

Check the file permissions:

```bash
chmod 600 .env
ls -l .env
```

Do not commit `.env`, print it in logs, or paste its contents into support
chats. The file is ignored by Git.

## 5. Start OpenDM

Validate the Compose file without printing the resolved secrets, then build and
start the stack:

```bash
cd /opt/opendm
docker compose config --quiet
docker compose up -d --build
```

The stack starts in this order:

1. PostgreSQL and Redis become healthy.
2. The one-shot `migrate` service applies all Prisma migrations and exits with
   status `0`.
3. The Next.js `web` service and BullMQ `worker` start.

Check the result:

```bash
docker compose ps -a
docker compose logs --tail=100 migrate web worker
```

After approximately 30 seconds, the health endpoint should report
`"status":"ok"` and `worker.healthy: true`:

```bash
curl --fail http://127.0.0.1:3000/api/health
```

An exited `migrate` container with exit code `0` is expected. Web, worker,
PostgreSQL, and Redis should remain running and healthy.

## 6. Configure the public Meta URLs

With `NEXTAUTH_URL=https://opendm.example.com`, configure the same Meta app with:

```text
OAuth redirect URI: https://opendm.example.com/api/instagram/callback
Webhook callback:   https://opendm.example.com/api/webhook
Verify token:       the exact WEBHOOK_VERIFY_TOKEN value from .env
Privacy policy:     https://opendm.example.com/privacy
Terms of service:   https://opendm.example.com/terms
Data deletion:      https://opendm.example.com/data-deletion
```

Subscribe the Instagram webhook to the `comments` and `messages` fields needed
by the enabled OpenDM features.

## 7. Update an existing installation

Back up PostgreSQL before an important release, then update `main` and recreate
the application containers:

```bash
cd /opt/opendm
git switch main
git pull --ff-only origin main
docker compose up -d --build
docker compose ps -a
```

Compose preserves the PostgreSQL and Redis named volumes. The migration service
runs before the updated application starts.

## Useful operational commands

```bash
# Follow application logs
docker compose logs -f web worker

# Restart only the application processes
docker compose restart web worker

# Stop containers without deleting data
docker compose down

# Start them again
docker compose up -d
```

Do not use `docker compose down --volumes` on a production server: it deletes
the PostgreSQL and Redis volumes.
