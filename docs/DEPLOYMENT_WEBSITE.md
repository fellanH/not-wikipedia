## not-wikipedia Static Site Deployment

> Serving the generated `not-wikipedia/` HTML as a static website.

The Ralph agent is responsible for generating and updating content in `not-wikipedia/`. This document focuses only on how to **serve** that directory as a static site. For deploying the agent itself, see `DEPLOYMENT_AGENT.md`.

---

### Option 1: Nginx on the Same VPS (recommended)

Run nginx alongside the Ralph agent on the same VPS using Docker Compose.

#### docker-compose.yml (static service)

Add an `nginx` service next to the `ralph` service:

```yaml
version: '3.8'
services:
  ralph:
    build: .
    # ...
    volumes:
      - /data/not-wikipedia:/app/not-wikipedia

  nginx:
    image: nginx:alpine
    volumes:
      - /data/not-wikipedia:/usr/share/nginx/html:ro
      - ./nginx.not-wikipedia.conf:/etc/nginx/conf.d/default.conf:ro
    ports:
      - "80:80"
    restart: unless-stopped
```

#### `nginx.not-wikipedia.conf`

```nginx
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    location / {
        try_files $uri $uri/ =404;
    }
}
```

With this setup:

- Ralph writes articles into `/data/not-wikipedia`.
- nginx serves that directory read-only to the public.

---

### Option 2: Separate Static Hosting (GitHub Pages / Netlify)

If you prefer not to run nginx yourself, you can periodically publish the `not-wikipedia/` directory to a static hosting provider.

#### Build artifact

1. Have the Ralph agent (or a separate script) sync `not-wikipedia/` into a `public/` directory or a dedicated repo.
2. Push that directory to:
   - **GitHub Pages**: `gh-pages` branch or `/docs` folder.
   - **Netlify / Vercel**: configure the site to serve from that directory.

Example GitHub Actions step to push `not-wikipedia/` to `gh-pages`:

```yaml
      - name: Publish not-wikipedia to gh-pages
        if: github.ref == 'refs/heads/main'
        run: |
          git config user.name "github-actions"
          git config user.email "github-actions@users.noreply.github.com"
          rm -rf out
          cp -R not-wikipedia out
          git checkout --orphan gh-pages
          git rm -rf .
          cp -R out/. .
          rm -rf out
          git add .
          git commit -m "Update not-wikipedia"
          git push -f origin gh-pages
```

---

### Data Persistence & Backups (Articles Only)

For full details see `DEPLOYMENT_AGENT.md` (also in this directory), but at a minimum:

- Treat `not-wikipedia/` as **the source of truth** for published content.
- Back it up regularly (e.g. S3 sync):

```bash
aws s3 sync /data/not-wikipedia s3://ralph-backups/articles/
```

If using separate static hosting (Option 2), you may treat the static host (e.g. GitHub Pages repo) as an additional backup.

---

### Checklist (Static Site)

- [ ] Decide on hosting approach:
  - [ ] nginx + Docker Compose on same VPS, or
  - [ ] external static hosting (GitHub Pages / Netlify / Vercel)
- [ ] Ensure `not-wikipedia/` is mounted or synced into the static host
- [ ] Configure DNS (optional but recommended)
- [ ] Put the site behind HTTPS (Let's Encrypt / provider-managed)
- [ ] Add `not-wikipedia/` to backup routine

