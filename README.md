# AI/ML Midterm — Web App

A clean, single-page exam web app for the 40-question midterm.
Auto-deploys to **GitHub Pages** via GitHub Actions on every push to `main`.

## What it does

- Welcome screen — student enters name + group
- Exam screen — 40 questions (30 MCQ + 10 fill-in), 90-minute timer, paginated with a clickable number grid
- Auto-saves every change to the browser (refresh-safe)
- Auto-submits when the timer hits 00:00
- Results screen — total score, A/B grade letter, per-question breakdown with the correct answer and a short explanation

## Run locally (no deploy needed)

You **cannot** open `index.html` directly with `file://` — the browser blocks `fetch("questions.json")`. Start a local server instead:

```bash
cd midterm-website
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy to GitHub Pages (one-time setup)

1. **Create a new repo on GitHub** (e.g. `midterm-website`). Public is fine for free Pages.
2. **Push this folder** to that repo:
   ```bash
   cd midterm-website
   git init
   git add .
   git commit -m "Initial midterm website"
   git branch -M main
   git remote add origin https://github.com/<YOUR-USERNAME>/midterm-website.git
   git push -u origin main
   ```
3. **Enable GitHub Pages**: repo → **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. That's it. Every push to `main` triggers `.github/workflows/deploy.yml`, which deploys the site.

Your URL will be: `https://<YOUR-USERNAME>.github.io/midterm-website/`

## Files

| File | Purpose |
| --- | --- |
| `index.html` | Markup for the 3 screens (welcome / exam / results) |
| `styles.css` | Exam-room styling, mobile-responsive |
| `app.js` | Timer, navigation, autosave, grading |
| `questions.json` | All 40 questions + accepted answers + explanations |
| `.github/workflows/deploy.yml` | GitHub Actions workflow that deploys to Pages |

## Editing the questions

Open `questions.json`. Each question is either `type: "mcq"` or `type: "fill"`.

**MCQ example:**
```json
{
  "id": 1, "type": "mcq", "points": 2, "difficulty": "easy",
  "question": "Which symbol starts a comment in Python?",
  "options": ["//", "/*", "#", "--"],
  "correct": 2,
  "explanation": "Python uses # for comments."
}
```
- `correct` is the **index** of the right option (0, 1, 2, or 3).

**Fill-in example:**
```json
{
  "id": 31, "type": "fill", "points": 4, "difficulty": "easy",
  "question": "The function that splits data is called:",
  "blanks": [
    { "accepts": ["train_test_split"], "points": 4, "placeholder": "function name" }
  ],
  "explanation": "from sklearn.model_selection import train_test_split"
}
```
- Each blank can accept multiple answers (case-insensitive by default).
- For multi-blank questions, distribute `points` across the blanks.
- Use `"case_sensitive": true` for code/identifier blanks.

Push your edit → Actions rebuilds → live in ~1 minute.

## Resetting a student's session

Tell them to open DevTools → Application → Local Storage → delete `midterm_state_v1` and `midterm_timer_end_v1`. Or use the **Take again** button on the results screen.

## What's intentionally NOT here

- No backend / no database — scores are local-only. If you need a class-wide leaderboard, that's a follow-up project (Supabase / Firebase / GitHub Issues API).
- No authentication — anyone with the URL can take the test. Add a passphrase gate in `app.js` if needed.
- No anti-cheat (no copy-paste disable, no fullscreen lock). This is a study tool, not a proctored exam.
