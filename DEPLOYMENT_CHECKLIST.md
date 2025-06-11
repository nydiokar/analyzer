# Deployment Checklist

This document provides a step-by-step checklist for deploying the backend and frontend of the Wallet Analyzer application. Follow these steps to ensure a smooth and successful deployment.

## Phase 1: Pre-flight & Configuration

- [ ] **1.1: Backend `.env` File:**
  - [x] Create or update the `.env` file in the project's root directory on your Raspberry Pi.
  - [ ] Verify `DATABASE_URL` is correct for your environment (e.g., `file:./data/prod.db`).
  - [ ] Verify `PORT` is set (e.g., `3001`).
  - [x] Generate a secure, random string and set it as `DEMO_API_KEY`.
  - [x] Define the list of public wallet addresses for `DEMO_WALLETS`, separated by commas with no spaces (e.g., `wallet1,wallet2,wallet3`).
  - [ ] Ensure `NODE_ENV` is set to `production`.

- [ ] **1.2: Frontend Vercel Environment Variables:**
  - [ ] In your Vercel project settings, navigate to "Environment Variables".
  - [ ] Set `NEXT_PUBLIC_API_BASE_URL` to your full public backend URL (e.g., `http://your-ddns-name.duckdns.org:3001/api/v1`).
  - [ ] Set `NEXT_PUBLIC_DEMO_API_KEY` to the **exact same value** as `DEMO_API_KEY` from your backend `.env` file.

- [ ] **1.3: Data for Demo Wallets:**
  - [ ] Before deploying, ensure you have run at least one analysis on each of your `DEMO_WALLETS`. This pre-populates the database so that demo users have data to view immediately. You can do this by running the `helius-analyzer.ts` script locally targeting those wallets.

## Phase 2: Backend Deployment (Raspberry Pi)

- [ ] **2.1: Get Latest Code:**
  - [ ] SSH into your Raspberry Pi.
  - [ ] Navigate to the project directory.
  - [ ] Run `git pull origin main` (or your primary branch) to get the latest changes.

- [ ] **2.2: Install Dependencies & Build:**
  - [ ] Run `npm install --production` to ensure all production dependencies are installed.
  - [ ] Run `npm run build` to compile the TypeScript project into JavaScript in the `dist/` folder.

- [ ] **2.3: Launch with PM2:**
  - [ ] Run `pm2 restart ecosystem.config.js --env production`. (Using `restart` is safe and will start it if it's not already running).
  - [ ] Verify the application is online with `pm2 list`.
  - [ ] Check for any startup errors with `pm2 logs my-analyzer-backend` (or the name you used in your ecosystem file).

- [ ] **2.4: Verify Network Accessibility:**
  - [ ] Double-check your router's port forwarding rules are active and correct.
  - [ ] Verify your Dynamic DNS (DDNS) hostname is correctly pointing to your home network's public IP address.

## Phase 3: Frontend Deployment (Vercel)

- [ ] **3.1: Get Latest Code to Git:**
  - [ ] On your local development machine, ensure all changes are committed.
  - [ ] Run `git push origin main` (or your primary branch).

- [ ] **3.2: Trigger Vercel Deployment:**
  - [ ] Vercel will automatically start a new build and deployment.
  - [ ] Monitor the deployment process in your Vercel dashboard and ensure it completes successfully.

## Phase 4: Post-Deployment Verification

- [ ] **4.1: Access the Dashboard:**
  - [ ] Open your public Vercel URL in a browser.

- [ ] **4.2: Test Demo Mode:**
  - [ ] On the landing page, copy the public demo key.
  - [ ] Paste it into the API key input field and save it.
  - [ ] Click on one of the demo wallet links.
  - [ ] **ASSERT:** The wallet dashboard loads correctly and displays data.
  - [ ] **ASSERT:** Time-range filters and other analytical UI elements function correctly with the pre-populated data.
  - [ ] **ASSERT:** Attempting to trigger a new analysis via its button results in a "Forbidden" error or a similar user-friendly message.

- [ ] **4.3: Test Private Key Mode:**
  - [ ] On the landing page, clear the demo key.
  - [ ] Enter a private, non-demo API key (you may need to create one in your database for testing).
  - [ ] Save the key.
  - [ ] Use the search bar to navigate to a non-demo wallet that has been analyzed.
  - [ ] **ASSERT:** The wallet dashboard loads correctly.
  - [ ] **ASSERT:** All functionality, including triggering a new analysis, works as expected. 