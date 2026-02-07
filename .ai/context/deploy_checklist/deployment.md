🔥 STEP 2: Firewall (UFW - Critical!)
bash# Install firewall
apt install -y ufw

# Allow SSH (port 22) - DO THIS FIRST or you'll lock yourself out!
ufw allow 22/tcp

# Allow HTTP and HTTPS (for web traffic)
ufw allow 80/tcp
ufw allow 443/tcp

# Enable firewall
ufw --force enable

# Check status
ufw status
What this does:

Blocks all incoming traffic EXCEPT ports you explicitly allow
Protects against random attacks/scans


👤 STEP 3: Create Non-Root User (Security Best Practice)
bash# Create new user (replace 'yourname' with your actual username)
adduser yourname

# Add to sudo group (can run admin commands)
usermod -aG sudo yourname

# Switch to new user to test
su - yourname

# Test sudo access
sudo whoami
# Should output: root

# Exit back to root
exit
Why: Running as root 24/7 is dangerous. One typo = server destroyed.

🔐 STEP 4: SSH Hardening (Do This After You Set Up SSH Keys)
For now, SKIP this. Do it later after you're comfortable.
But here's what you'll eventually do:
bash# Disable root SSH login (after you set up your user + SSH keys)
nano /etc/ssh/sshd_config

# Find and change these lines:
# PermitRootLogin yes → PermitRootLogin no
# PasswordAuthentication yes → PasswordAuthentication no (forces SSH keys)

# Restart SSH
systemctl restart sshd
WARNING: Don't do this yet or you might lock yourself out!

⏰ STEP 5: Set Timezone
bash# Set to your timezone (important for logs)
timedatectl set-timezone Europe/Berlin  # or America/New_York, etc.

# Check it worked
timedatectl

🐳 STEP 6: Install Docker (Highly Recommended)
Docker makes deployment SO much easier:
bash# Install Docker
curl -fsSL https://get.docker.com | sh

# Start Docker
systemctl start docker
systemctl enable docker

# Add your user to docker group (so you don't need sudo)
usermod -aG docker yourname  # replace with your username

# Install Docker Compose
apt install -y docker-compose-plugin

# Test it works
docker --version
docker compose version
Why Docker: Package your app + all dependencies. Deploy anywhere. No "works on my machine" problems.

📦 STEP 7: Install Node.js (For Claude Code & Most Modern Apps)
bash# Install Node.js 20 (LTS)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Verify
node --version
npm --version

# Install pm2 (keeps Node apps running)
npm install -g pm2
Why PM2: Keeps your Node app running forever, auto-restarts on crash.

🌐 STEP 8: Install Nginx (Web Server / Reverse Proxy)
bash# Install Nginx
apt install -y nginx

# Start and enable
systemctl start nginx
systemctl enable nginx

# Check status
systemctl status nginx

# Test it works
curl localhost
# Should show "Welcome to nginx!"
Why Nginx:

Serves your frontend files
Routes traffic to your backend
Handles SSL certificates
Super fast and stable


🔒 STEP 9: Install Certbot (Free SSL Certificates)
bash# Install Certbot
apt install -y certbot python3-certbot-nginx
You'll use this later to get HTTPS (after you point your domain to the server).

📊 STEP 10: Monitoring Basics
bash# Install helpful monitoring tools
apt install -y htop iotop nethogs

# See what's using resources
htop           # CPU/RAM usage (press q to exit)
df -h          # Disk space
free -h        # Memory usage

🛡️ STEP 11: Fail2Ban (Auto-Block Attackers)
bash# Install Fail2Ban (blocks IPs that try to brute-force SSH)
apt install -y fail2ban

# Start it
systemctl start fail2ban
systemctl enable fail2ban

# Check status
fail2ban-client status sshd
What this does: After 5 failed SSH login attempts, IP gets banned for 10 minutes.

✅ STEP 12: Verify Everything Works
bash# Quick health check
systemctl status nginx
systemctl status docker
systemctl status fail2ban
ufw status
node --version
docker --version
All should show "active (running)" or version numbers.

📝 Your Essential DevOps Checklist:
✅ System updated
✅ Firewall configured (UFW)
✅ Non-root user created
✅ Docker installed
✅ Node.js installed
✅ Nginx installed
✅ Certbot ready for SSL
✅ Fail2Ban protecting SSH
✅ Timezone set