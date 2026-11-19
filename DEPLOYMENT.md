# VTU Smart Attendance System — Production Deployment Guide

This guide covers deploying the full-stack VTU Smart Attendance System (React 19 Frontend + Express Backend + Pretrained InsightFace ArcFace / SCRFD ONNX Inference Engine + SQLite Session Guard + MongoDB Atlas / Local Store).

---

## ⚠️ Critical Deployment Prerequisite: HTTPS is Mandatory
Modern browsers (Google Chrome, Apple Safari, Mozilla Firefox, Microsoft Edge) **strictly disable camera (`navigator.mediaDevices.getUserMedia`) and geolocation on non-secure origins**.
* **Localhost** (`http://localhost:3000`) is permitted for testing.
* **Any public domain or IP** (`http://192.168.x.x` or `http://your-server.com`) **MUST HAVE SSL/HTTPS enabled**. Without HTTPS, camera access for facial verification will be blocked by the student's browser.

---

## Option 1: Cloud PaaS Deployment (Render / Railway) — Recommended & Fastest

### Deploying on Render (Using `render.yaml`)
1. Push your repository to **GitHub** or **GitLab**.
2. Log in to [Render Dashboard](https://dashboard.render.com/).
3. Click **New +** → **Blueprint**.
4. Connect your repository. Render will automatically detect the [render.yaml](file:///Users/rahulshirol/vtu-smart-attendance-2/render.yaml) file.
5. In the environment variables section, fill in:
   * `MONGODB_URI`: Your MongoDB Atlas connection URI.
   * `APP_URL`: Your Render service URL (e.g., `https://vtu-smart-attendance.onrender.com`).
6. Click **Apply**. Render will automatically:
   * Build the frontend with `npm run build`.
   * Start the Node server with `npm start`.
   * Provide a free automated **SSL (HTTPS)** certificate.

---

### Deploying on Railway
1. Log in to [Railway.app](https://railway.app/).
2. Click **New Project** → **Deploy from GitHub repo**.
3. Select this repository.
4. Go to **Settings** → **Networking** → **Generate Domain** (gives you a secure `https://xxx.up.railway.app` URL).
5. Go to **Variables** and add the required environment variables (see [Environment Variables Checklist](#environment-variables-checklist)).
6. Railway will build via Dockerfile or Node buildpack automatically.

---

## Option 2: Docker Container Deployment

The repository includes a production multi-stage [Dockerfile](file:///Users/rahulshirol/vtu-smart-attendance-2/Dockerfile) that bundles frontend build assets and ONNX AI models.

### 1. Build the Docker Image
```bash
docker build -t vtu-smart-attendance:latest .
```

### 2. Run the Container
```bash
docker run -d \
  --name vtu-attendance \
  -p 3000:3000 \
  --env-file .env \
  -v vtu_local_db:/app/.local_db \
  -v vtu_private_uploads:/app/.private_uploads \
  -v vtu_secure_store:/app/.secure_store \
  --restart always \
  vtu-smart-attendance:latest
```

---

## Option 3: Virtual Private Server (VPS / AWS EC2 / DigitalOcean / Linode)

For self-hosted Linux servers (Ubuntu 22.04 / 24.04 LTS).

### 1. System Setup
```bash
sudo apt update && sudo apt upgrade -y
# Install Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs nginx certbot python3-certbot-nginx git
sudo npm install -g pm2
```

### 2. Clone & Build
```bash
cd /var/www
sudo git clone <your-repo-url> vtu-smart-attendance
cd vtu-smart-attendance
sudo npm install
sudo npm run build
```

### 3. Configure Environment Variables
```bash
sudo cp .env.example .env
sudo nano .env # Fill in MongoDB URI, secrets, and APP_URL
```

### 4. Start with PM2 Process Manager
```bash
# Start background cluster
pm2 start "npm start" --name "vtu-smart-attendance"
pm2 save
pm2 startup
```

### 5. Configure Nginx Reverse Proxy with HTTPS
Create `/etc/nginx/sites-available/vtu-attendance`:
```nginx
server {
    server_name attendance.yourcollege.edu.in;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

Enable site and configure SSL:
```bash
sudo ln -s /etc/nginx/sites-available/vtu-attendance /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

# Automatically provision Let's Encrypt SSL
sudo certbot --nginx -d attendance.yourcollege.edu.in
```

---

## Environment Variables Checklist

Ensure these variables are set in production:

| Variable | Description | Example / Default |
| :--- | :--- | :--- |
| `NODE_ENV` | Application environment | `production` |
| `PORT` | Listening port | `3000` |
| `APP_URL` | Public HTTPS domain URL | `https://attendance.yourcollege.edu.in` |
| `MONGODB_URI` | MongoDB Atlas cluster connection string | `mongodb+srv://user:pass@cluster0.xxx.mongodb.net/vtu_attendance` |
| `JWT_SECRET` | Secret key for JWT auth tokens | `64-character random string` |
| `BIOMETRIC_ENCRYPTION_KEY` | AES-256 key for encrypted facial references | `32-character cryptographic string` |
| `VERIFICATION_SESSION_SECRET` | HMAC secret for one-time anti-replay tokens | `32-character cryptographic string` |
| `PARENT_APP_AUTH_SECRET` | Secret for parent app signature verification | `32-character cryptographic string` |
| `ENROLLMENT_ADMIN_KEY` | Admin authorization key for facial enrollment | `32-character cryptographic string` |
| `ARCFACE_COSINE_THRESHOLD` | Facial recognition similarity threshold | `0.40` |
| `SMTP_HOST` | Mail server host (Optional, for Forgot Password email) | `smtp.gmail.com` |
| `SMTP_PORT` | Mail server port | `587` |
| `SMTP_USER` | Mail server username / address | `noreply@yourcollege.edu.in` |
| `SMTP_PASS` | Mail server app password | `App-specific password` |

---

## Post-Deployment Verification Checklist

1. **Health & Version Check**:
   Navigate to `https://your-domain/api/meta` — ensure HTTP 200 and institution metadata return.
2. **Camera Permission Check**:
   Open on a smartphone or laptop browser. Verify that the browser prompts for camera permission without SSL errors.
3. **Dynamic QR Rotation Check**:
   Log in as faculty, start a QR session, and confirm the dynamic QR rotates every 5 seconds.
4. **Biometric Face Verification Check**:
   Scan the dynamic QR on a student device, verify face framing aligns, blink detection triggers, and attendance marks as `VERIFIED`.
5. **Session Invalidation Check**:
   Test changing or resetting a password to confirm old sessions are revoked.
