# Solar Inverter ERP — Complete Deployment Guide
## From Zero to Live on the Internet (Mac)

---

## What You Will Have at the End
- A live web app at a public URL (e.g. `https://solar-erp.vercel.app`)
- Secure email + password login
- All data saved permanently in a cloud database
- Accessible from any device, anywhere

**Time required: ~45 minutes (one time only)**

---

## PART 1 — Set Up the Database (Supabase)
*Supabase is your free cloud database + login system*

### Step 1.1 — Create a free Supabase account
1. Go to **https://supabase.com**
2. Click **Start your project** → Sign up with Google or email
3. Once logged in, click **New Project**
4. Fill in:
   - **Name:** `solar-erp`
   - **Database Password:** Choose a strong password and **save it somewhere safe**
   - **Region:** Choose `Southeast Asia (Singapore)` — closest to India
5. Click **Create new project** — wait ~2 minutes for it to set up

### Step 1.2 — Create the database tables
1. In your Supabase project, click **SQL Editor** in the left sidebar
2. Click **New Query**
3. Open the file `supabase_schema.sql` from the project folder
4. Copy the **entire contents** and paste into the SQL editor
5. Click **Run** (the green button)
6. You should see: `Success. No rows returned`

### Step 1.3 — Get your API credentials
1. In Supabase, click **Settings** (gear icon) → **API**
2. You will see two values — keep this tab open, you'll need them in Part 3:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon / public key** — a long string starting with `eyJ...`

### Step 1.4 — Create user accounts (for you and your accountant)
1. In Supabase, click **Authentication** → **Users** → **Add User**
2. Enter your email and a password → **Create User**
3. Repeat for your accountant's email
4. ⚠️ **Important:** These are the only people who can log in. Never share these credentials.

---

## PART 2 — Set Up Your Mac for Development (One Time Only)

### Step 2.1 — Install Node.js
1. Open **Terminal** (press `Cmd + Space`, type "Terminal", press Enter)
2. Type: `node -v` and press Enter
3. If you see a version number like `v18.x.x` → skip to Step 2.2
4. If you see "command not found":
   - Go to **https://nodejs.org**
   - Download the **LTS** version
   - Run the installer, click through all the steps

### Step 2.2 — Install Git
1. In Terminal, type: `git --version`
2. If you see a version → already installed, skip ahead
3. If not: go to **https://git-scm.com** and download the Mac installer

---

## PART 3 — Configure and Run the App

### Step 3.1 — Place the project folder
1. Move the `solar-erp` folder to a convenient location, e.g. your Desktop or Documents

### Step 3.2 — Add your Supabase credentials
1. Inside the `solar-erp` folder, find the file called `.env.example`
2. Make a copy of it and rename the copy to `.env.local`
   - In Terminal: `cd ~/Desktop/solar-erp && cp .env.example .env.local`
3. Open `.env.local` in TextEdit (right-click → Open With → TextEdit)
4. Replace the placeholder values with your real Supabase values from Step 1.3:
```
REACT_APP_SUPABASE_URL=https://your-actual-project-id.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJyour-actual-anon-key-here
```
5. Save and close the file

### Step 3.3 — Install dependencies
1. In Terminal:
```bash
cd ~/Desktop/solar-erp
npm install
```
This will take 2–3 minutes the first time.

### Step 3.4 — Test locally
```bash
npm start
```
Your browser will open at `http://localhost:3000`
- You should see the login page
- Log in with the email/password you created in Supabase (Step 1.4)
- The full ERP should load ✓

Press `Ctrl + C` in Terminal to stop the local server when done testing.

---

## PART 4 — Deploy to the Internet (Vercel)

### Step 4.1 — Create a GitHub account (if you don't have one)
Go to **https://github.com** and sign up for a free account.

### Step 4.2 — Upload your code to GitHub
In Terminal (inside the solar-erp folder):
```bash
git init
git add .
git commit -m "Initial commit"
```
Then:
1. Go to **https://github.com/new**
2. Repository name: `solar-erp`
3. Set to **Private** ← important
4. Click **Create repository**
5. GitHub will show you commands — copy and run the two lines that look like:
```bash
git remote add origin https://github.com/YOUR-USERNAME/solar-erp.git
git push -u origin main
```

### Step 4.3 — Deploy on Vercel
1. Go to **https://vercel.com** → Sign up / Log in with GitHub
2. Click **Add New Project**
3. Find `solar-erp` in the list → click **Import**
4. Expand **Environment Variables** and add these two:
   - Name: `REACT_APP_SUPABASE_URL` → Value: your Supabase project URL
   - Name: `REACT_APP_SUPABASE_ANON_KEY` → Value: your Supabase anon key
5. Click **Deploy**
6. Wait ~2 minutes → Vercel gives you a live URL like `https://solar-erp-xyz.vercel.app`

**Your app is now live on the internet! ✓**

### Step 4.4 — Optional: Set a custom domain
In Vercel → your project → **Settings** → **Domains**
You can add your own domain (e.g. `erp.yourcompany.com`) if you have one.

---

## PART 5 — Day-to-Day Usage

### How you and your accountant access it
- Go to your Vercel URL from any browser, any device
- Log in with email + password
- All data is shared — changes made by your accountant appear on your screen

### How to update the app in future
If you want to make changes to the code:
1. Edit the files on your Mac
2. In Terminal:
```bash
git add .
git commit -m "Describe your change"
git push
```
Vercel automatically redeploys within 1–2 minutes.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "npm: command not found" | Reinstall Node.js from nodejs.org |
| Login says "Invalid credentials" | Check the user was created in Supabase → Authentication → Users |
| Data not saving | Check `.env.local` has the correct Supabase URL and key |
| Page shows blank after deploy | Check Environment Variables are set correctly in Vercel |
| "relation does not exist" error | Re-run the `supabase_schema.sql` in the SQL editor |

---

## Security Notes
- Your `.env.local` file is in `.gitignore` — it will never be uploaded to GitHub ✓
- Row Level Security (RLS) is enabled — only logged-in users can see/edit data ✓
- The anon key is safe to use in the frontend — it cannot bypass RLS ✓
- Never share your Supabase database password with anyone ✓

---

*Built for: Solar Inverter Distributor ERP*
*Stack: React + Supabase (PostgreSQL + Auth) + Vercel*
