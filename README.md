# 🇬🇧 Telegram English Tracker Bot 🤖🔥

An intelligent, AI-powered Telegram bot designed to build consistency and daily English practice through a challenge between study partners.

The bot uses **Google Gemini AI** to interpret natural language messages, validate learned phrases, provide grammar feedback, and manage daily streaks, weekly shields, and miss penalties.

---

## 🚀 Key Features

* 🧠 **Natural Language Processing (Gemini 2.5 Flash-Lite):** Understands both explicit commands (`/done`, `/shield`, `/status`) and casual conversations in Spanish/English (e.g., *"today I learned I went to the store"*, *"I need a shield today"*).
* 📝 **Validation & Grammar Feedback:** Ensures submitted phrases have real learning substance (minimum 10+ characters) and provides quick grammatical tips or vocabulary suggestions.
* 🔥 **Daily Streaks:** Tracks consecutive days of active practice.
* 🛡️ **Weekly Break Shields:** Each user receives 2 shields per week (resetting every Monday) to take rest days without losing their streak.
* 🔄 **Automatic Shield Refund:** If a user activates a shield but later decides to practice and submit their phrase on the same day, their shield is automatically refunded.
* ⏰ **Midnight Automatic Evaluation (Vercel Cron Jobs):** Checks user compliance at the end of each day based on their local time zone (e.g., Argentina / Mexico). If a user misses practice and has no shields left, their streak resets to `0` and a **random penalty** is announced in the group chat.

---

## 🛠️ Tech Stack

* **Runtime:** Node.js (ES Modules)
* **Serverless Hosting:** Vercel Serverless Functions
* **Database:** Vercel KV (`@vercel/kv` / Upstash Redis)
* **Artificial Intelligence:** Google Gemini API (`gemini-2.5-flash-lite`, with fallback to `gemini-1.5-flash-lite` and token-optimized generation limits)
* **Messaging Integration:** Telegram Bot API (Webhook)
* **Cron Jobs:** Vercel Cron Jobs

---

## 📁 Project Architecture

```text
telegram-english-bot/
├── api/
│   ├── _db.js        # State management (Vercel KV / In-memory Mock KV for local dev)
│   ├── _telegram.js  # Telegram Bot API message dispatcher
│   ├── _time.js      # Date & timezone utility functions (America/Argentina/Buenos_Aires & America/Mexico_City)
│   ├── webhook.js    # Serverless endpoint for incoming Telegram updates & Gemini AI processing
│   └── cron.js       # Serverless endpoint for daily evaluations and weekly shield resets
├── scratch/
│   └── test-flow.js  # Offline integration test suite simulating full user interactions
├── .env.example      # Environment variables template
├── .gitignore        # Git ignore rules for node_modules and secret env files
├── package.json      # Dependencies and script definitions
└── vercel.json       # Vercel Cron Job schedule configuration
```

---

## 🤖 Bot Commands

The bot supports both slash commands (`/`) and natural language messages:

| Command | Description |
| :--- | :--- |
| `/start` | Welcome message and quick start guide. |
| `/done <phrase>` | Logs your daily English practice (minimum 10 characters). |
| `/shield` | Activates a protective shield for a rest day without losing your streak. |
| `/status` | Displays current streaks, available shields, and daily status for all members. |

---

## 💻 Local Development & Testing

1. **Clone the repository and install dependencies:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/telegram-english-bot.git
   cd telegram-english-bot
   npm install
   ```

2. **Run the offline integration test suite:**
   The project includes a complete mock integration test that simulates Telegram updates, Gemini responses, and database updates locally:
   ```bash
   npm test
   ```

---

## 🌐 Production Deployment (Vercel)

### 1. Configure the Telegram Bot (`@BotFather`)
1. Create a bot in Telegram using `@BotFather` (`/newbot`) and save your `TELEGRAM_BOT_TOKEN`.
2. **Important:** Turn OFF Group Privacy to allow natural language reading in groups:
   - Send `/mybots` $\rightarrow$ Select your bot $\rightarrow$ **Bot Settings** $\rightarrow$ **Group Privacy** $\rightarrow$ **Turn OFF**.
3. Add the bot to your Telegram study group.

### 2. Create Vercel KV Storage
1. In your [Vercel Dashboard](https://vercel.com/), go to **Storage** $\rightarrow$ **Create Database** $\rightarrow$ **KV (Redis)**.
2. Connect it to your project. Vercel will automatically populate the required KV environment variables (`KV_REST_API_URL`, `KV_REST_API_TOKEN`, etc.).

### 3. Environment Variables Setup
In Vercel **Settings** $\rightarrow$ **Environment Variables**, add the following:

| Variable | Description | Example |
| :--- | :--- | :--- |
| `TELEGRAM_BOT_TOKEN` | Bot API Token from BotFather | `123456789:ABC...` |
| `TELEGRAM_CHAT_ID` | Telegram Group Chat ID | `-100123456789` |
| `GEMINI_API_KEY` | Google AI Studio API Key | `AIzaSy...` |
| `CRON_SECRET` | Secret key to authorize Vercel Cron | `your_random_secret_here` |
| `USER_A_USERNAME` | Telegram username for Member A | `user_a_username` |
| `USER_B_USERNAME` | Telegram username for Member B | `user_b_username` |
| `USER_A_NAME` | Display name for Member A | `User A` |
| `USER_B_NAME` | Display name for Member B | `User B` |

### 4. Register the Webhook
Once deployed on Vercel, register the webhook with Telegram by opening this URL in your browser:

```text
https://api.telegram.org/bot<YOUR_TELEGRAM_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_PROJECT>.vercel.app/api/webhook
```

---

## 📜 License

This project is licensed under the MIT License. Feel free to clone and use it for your own language learning challenges! 🚀
