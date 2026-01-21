# 🛰️ Twitter / X List Monitor

**Headless browser–based monitoring of X (Twitter) lists with visual capture & Telegram delivery**

---

## 📸 Visual Preview

![Tweet capture example 1](docs/images/2026-01-21_13-03.png)
![Tweet capture example 2](docs/images/2026-01-21_13-04.png)
![Tweet capture example 3](docs/images/tweet_BarakSeri_1995098138311287087.png)

---

## 🧠 Project Overview

This project continuously monitors **X (Twitter) Lists** using a **single authenticated browser session**, detects new tweets deterministically, captures **clean visual screenshots** of each tweet, and delivers them to **Telegram channels**.

The system is designed for **long-running, unattended execution**, with strong emphasis on:

- correctness  
- reproducibility  
- memory efficiency  
- operational robustness  

---

## 🧩 Architecture Overview

![Architecture diagram](docs/images/architecture.png)

### High-level flow

1. Puppeteer launches **one persistent browser**
2. Authenticated session is restored via cookies
3. List feeds are scanned incrementally
4. New tweets are persisted to per-list databases
5. Tweets are rendered, cleaned, and visually captured
6. Final images are delivered to Telegram

---

## ⚙️ Key Characteristics

- **Single-browser architecture**  
  Multiple lists share one browser → drastic memory reduction

- **Deterministic feed scanning**  
  No guesswork, no heuristics, no race conditions

- **Per-list isolated persistence**  
  Each list has its own database lifecycle

- **Visual capture (not raw text)**  
  What you see is exactly what gets sent

- **Telegram delivery with retries**  
  Rate-limit aware, fault-tolerant

- **Production-oriented design**  
  Safe restarts, state recovery, defensive timeouts

---

## 🗂 Configuration Model

All runtime behavior is driven by a **single configuration file**, aggregating:

- global browser settings  
- shared runtime paths  
- per-list definitions (URLs, DB naming, output routing)

This allows:

- scaling from 1 → N lists
- zero code duplication
- predictable operational behavior

---

## 🧪 Operational Notes

- Designed to run **24/7**
- Memory usage is bounded and measured
- Browser crashes trigger clean restarts
- No reliance on undocumented APIs

---

## ⚠️ Disclaimer

This project is provided **for educational and technical demonstration purposes only**.

- No responsibility is taken for misuse
- Users are responsible for complying with all applicable laws
- The project demonstrates automation and system design techniques

---

## 👤 Author

Built as a **system-level automation project**, focusing on:

- browser internals  
- deterministic data collection  
- long-running reliability  
- operational clarity  
