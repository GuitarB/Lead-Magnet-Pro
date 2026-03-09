# Lead-Magnet Pro

Lead-Magnet Pro is a high-margin Micro-SaaS that generates professional, conversion-focused lead magnets using AI.

Users can enter a brand URL or business description and instantly generate a polished lead magnet formatted as PDF-ready HTML.

The goal of this project is to create a fast, serverless, scalable lead generation tool built on modern web infrastructure.

---

# Features

• AI-generated lead magnets  
• PDF-ready formatted HTML output  
• Serverless architecture  
• Stripe Checkout payment gate  
• Deploys automatically from GitHub  

---

# Tech Stack

Frontend  
• HTML5  
• TailwindCSS (CDN)  
• Vanilla ES6 JavaScript  

Backend  
• Cloudflare Pages Functions  

AI  
• OpenAI API (GPT-4o)

Payments  
• Stripe Checkout

Deployment  
• Cloudflare Pages (GitHub integrated)

---

# Project Architecture

Lead-Magnet-Pro/
│
├── index.html
├── package.json
├── README.md
├── .gitignore
│
├── functions/
│   └── api/
│       ├── generate.js
│       └── create-checkout-session.js
│
└── public/
└── assets/

---

# How It Works

1. User enters a brand URL or description
2. The frontend sends a request to `/api/generate`
3. Cloudflare Pages Function calls the OpenAI API
4. The AI returns structured HTML content
5. The UI renders the generated lead magnet

---

# Environment Variables

This project requires the following environment variables inside Cloudflare Pages:

OPENAI_API_KEY  
STRIPE_SECRET_KEY  
STRIPE_PRICE_AMOUNT (optional, defaults to 900 cents)  
STRIPE_CURRENCY (optional, defaults to usd)  
SITE_URL (optional, used for Stripe success/cancel redirects)

Add it inside:

Cloudflare Dashboard
Pages → Lead-Magnet-Pro → Settings → Environment Variables

Then redeploy the project.

---

# Development Roadmap

Phase 1  
✔ Project architecture  
✔ Landing page UI  
✔ Dashboard interface  

Phase 2  
✔ Cloudflare Functions  
✔ OpenAI integration  

Phase 3  
⬜ Stripe checkout integration  

Phase 4  
⬜ PDF export  
⬜ Lead magnet templates  
⬜ SaaS pricing model

---

# Deployment

The project automatically deploys via GitHub → Cloudflare Pages.

Any commit to the `main` branch triggers a new deployment.

---

# License

MIT License