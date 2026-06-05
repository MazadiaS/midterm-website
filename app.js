/* ============================================================
   AI/ML Midterm — exam app
   Loads questions.json, renders questions, runs timer,
   autosaves to localStorage, grades on submit.
   ============================================================ */

const STORAGE_KEY = "midterm_state_v3";
const TIMER_KEY = "midterm_timer_end_v3";
const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwPbJZkcRfVXwJ3cbSSd3CbefvxWF1qMoZQJlnPkMQ_twEkegnUpXq5ojNYuPXw8U8/exec";

const state = {
  data: null,
  flat: [],       // flat list of all questions in order
  answers: {},    // { qid: mcqIndex }  OR  { qid: [blank1, blank2] }
  current: 0,     // current question index in flat list
  student: { name: "", group: "" },
  finished: false,
  tabSwitches: 0, // anti-cheat: count of times the student left the tab
};

const el = {
  welcome: document.getElementById("welcome"),
  welcomeTitle: document.getElementById("welcome-title"),
  welcomeSubtitle: document.getElementById("welcome-subtitle"),
  studentName: document.getElementById("student-name"),
  studentGroup: document.getElementById("student-group"),
  startBtn: document.getElementById("start-btn"),
  startHint: document.getElementById("start-hint"),

  exam: document.getElementById("exam"),
  studentDisplay: document.getElementById("student-display"),
  timer: document.getElementById("timer"),
  progressText: document.getElementById("progress-text"),
  questionContainer: document.getElementById("question-container"),
  prevBtn: document.getElementById("prev-btn"),
  nextBtn: document.getElementById("next-btn"),
  submitBtn: document.getElementById("submit-btn"),
  questionGrid: document.getElementById("question-grid"),

  results: document.getElementById("results"),
  resultsStudent: document.getElementById("results-student"),
  totalScore: document.getElementById("total-score"),
  gradeBadge: document.getElementById("grade-badge"),
  sectionAScore: document.getElementById("section-a-score"),
  sectionBScore: document.getElementById("section-b-score"),
  breakdown: document.getElementById("breakdown"),
  retakeBtn: document.getElementById("retake-btn"),
  printBtn: document.getElementById("print-btn"),

  confirmModal: document.getElementById("confirm-modal"),
  confirmSummary: document.getElementById("confirm-summary"),
  confirmCancel: document.getElementById("confirm-cancel"),
  confirmSubmit: document.getElementById("confirm-submit"),
};

/* ============= Boot ============= */
async function boot() {
  try {
    const res = await fetch("questions.json?v=" + Date.now());
    state.data = await res.json();
  } catch (e) {
    alert("Failed to load questions.json — make sure it is in the same folder.");
    console.error(e);
    return;
  }

  // Flatten all questions into one ordered list
  state.flat = [];
  for (const section of state.data.sections) {
    for (const q of section.questions) {
      state.flat.push({ ...q, sectionId: section.id, sectionName: section.name });
    }
  }

  el.welcomeTitle.textContent = state.data.title;
  el.welcomeSubtitle.textContent = state.data.subtitle || "";

  // Restore in-progress exam?
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.student && !parsed.finished) {
        Object.assign(state, parsed);
        startExam(true); // resume
        return;
      }
    } catch (e) {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  // Listeners
  el.studentName.addEventListener("input", validateStart);
  el.studentGroup.addEventListener("input", validateStart);
  el.startBtn.addEventListener("click", () => {
    // Defensive: ensure a completely fresh state for a brand-new attempt
    state.answers = {};
    state.current = 0;
    state.tabSwitches = 0;
    state.finished = false;
    state.student.name = el.studentName.value.trim();
    state.student.group = el.studentGroup.value.trim();
    startExam(false);
  });

  el.prevBtn.addEventListener("click", () => goTo(state.current - 1));
  el.nextBtn.addEventListener("click", () => goTo(state.current + 1));
  el.submitBtn.addEventListener("click", showSubmitModal);

  el.confirmCancel.addEventListener("click", () => el.confirmModal.classList.remove("active"));
  el.confirmSubmit.addEventListener("click", () => {
    el.confirmModal.classList.remove("active");
    submitExam();
  });

  el.retakeBtn.addEventListener("click", retake);
  el.printBtn.addEventListener("click", () => window.print());
}

function validateStart() {
  const ok = el.studentName.value.trim().length > 1 && el.studentGroup.value.trim().length > 0;
  el.startBtn.disabled = !ok;
  el.startHint.style.display = ok ? "none" : "block";
}

/* ============= Start exam ============= */
function startExam(resume) {
  switchScreen("exam");
  el.studentDisplay.textContent = `${state.student.name} · ${state.student.group}`;
  renderGrid();
  goTo(state.current);
  startTimer(resume);
  installAntiCheat();
  persist();
}

/* ============= Anti-cheat ============= */
function isExamActive() {
  return !state.finished && document.getElementById("exam").classList.contains("active");
}

function installAntiCheat() {
  // Block right-click during exam
  document.addEventListener("contextmenu", e => {
    if (isExamActive()) e.preventDefault();
  });

  // Block copy / cut from the question area (not from inputs — students must be able to edit)
  document.addEventListener("copy", e => {
    if (isExamActive() && !isEditable(e.target)) e.preventDefault();
  });
  document.addEventListener("cut", e => {
    if (isExamActive() && !isEditable(e.target)) e.preventDefault();
  });

  // Block paste in answer inputs (so students cannot paste prepared answers)
  document.addEventListener("paste", e => {
    if (isExamActive() && isEditable(e.target)) {
      e.preventDefault();
      flashWarning("Pasting is not allowed during the exam.");
    }
  });

  // Block keyboard shortcuts: Ctrl+C / Ctrl+V / Ctrl+X / Ctrl+A / F12 / Cmd+Option+I
  document.addEventListener("keydown", e => {
    if (!isExamActive()) return;
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && ["c", "v", "x", "a", "s", "p"].includes(k) && !isEditable(e.target)) {
      e.preventDefault();
    }
    if (ctrl && ["v"].includes(k) && isEditable(e.target)) {
      e.preventDefault();
      flashWarning("Pasting is not allowed during the exam.");
    }
    // DevTools shortcuts
    if (e.key === "F12") e.preventDefault();
    if (ctrl && e.shiftKey && ["i", "j", "c"].includes(k)) e.preventDefault();
  });

  // Tab-switch / window-blur detection
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && isExamActive()) {
      state.tabSwitches++;
      persist();
      flashWarning(`You left the exam tab. This was recorded (${state.tabSwitches} time${state.tabSwitches === 1 ? "" : "s"}).`);
    }
  });
}

function isEditable(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function flashWarning(msg) {
  let toast = document.getElementById("anticheat-toast");
  if (!toast) {
    toast = document.createElement("div");
    toast.id = "anticheat-toast";
    toast.className = "anticheat-toast";
    document.body.appendChild(toast);
  }
  toast.textContent = "⚠ " + msg;
  toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => toast.classList.remove("show"), 2500);
}

/* ============= Timer ============= */
let timerInterval = null;
function startTimer(resume) {
  let endTime;
  if (resume && localStorage.getItem(TIMER_KEY)) {
    endTime = parseInt(localStorage.getItem(TIMER_KEY), 10);
  } else {
    endTime = Date.now() + state.data.duration_minutes * 60 * 1000;
    localStorage.setItem(TIMER_KEY, endTime.toString());
  }

  function tick() {
    const remaining = Math.max(0, endTime - Date.now());
    const mins = Math.floor(remaining / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    el.timer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;

    el.timer.classList.toggle("warning", remaining < 10 * 60 * 1000 && remaining > 2 * 60 * 1000);
    el.timer.classList.toggle("danger", remaining <= 2 * 60 * 1000);

    if (remaining <= 0) {
      clearInterval(timerInterval);
      submitExam();
    }
  }
  tick();
  timerInterval = setInterval(tick, 1000);
}

/* ============= Navigation ============= */
function goTo(idx) {
  if (idx < 0 || idx >= state.flat.length) return;
  state.current = idx;
  renderQuestion();
  renderGrid();
  el.progressText.textContent = `Question ${idx + 1} / ${state.flat.length}`;
  el.prevBtn.disabled = idx === 0;
  el.nextBtn.disabled = idx === state.flat.length - 1;
  persist();
}

/* ============= Render one question ============= */
function renderQuestion() {
  const q = state.flat[state.current];
  const sectionStart = state.flat[state.current - 1]?.sectionId !== q.sectionId;

  const sectionBanner = sectionStart || state.current === 0
    ? `<div class="section-banner">${escape(q.sectionName)}</div>` : "";

  const meta = `
    <div class="q-meta">
      <span class="points">${q.points} pts</span>
      <span class="diff ${q.difficulty}">${q.difficulty}</span>
      <span>Q ${q.id}</span>
    </div>`;

  const text = `<div class="q-text">${escape(q.question).replace(/\n/g, "<br>")}</div>`;

  let body = "";
  if (q.type === "mcq") {
    const selected = state.answers[q.id];
    const letters = ["A", "B", "C", "D"];
    body = `<div class="options">` + q.options.map((opt, i) => `
      <label class="option ${selected === i ? "selected" : ""}">
        <input type="radio" name="q${q.id}" value="${i}" ${selected === i ? "checked" : ""}>
        <span class="option-letter">${letters[i]})</span>
        <span>${escape(opt)}</span>
      </label>
    `).join("") + `</div>`;
  } else if (q.type === "fill") {
    const saved = state.answers[q.id] || [];
    body = `<div class="fill-blanks">` + q.blanks.map((blank, i) => `
      <div class="fill-blank">
        <label>Blank ${i + 1} ${blank.placeholder ? `(${escape(blank.placeholder)})` : ""}</label>
        <input type="text" data-blank="${i}" value="${escape(saved[i] || "")}" autocomplete="off" spellcheck="false">
      </div>
    `).join("") + `</div>`;
  }

  el.questionContainer.innerHTML = sectionBanner + meta + text + body;

  // Wire up answer changes
  if (q.type === "mcq") {
    el.questionContainer.querySelectorAll("input[type=radio]").forEach(r => {
      r.addEventListener("change", e => {
        const picked = parseInt(e.target.value, 10);
        state.answers[q.id] = picked;
        // Update only the visual selection — do NOT re-render (destroys DOM)
        el.questionContainer.querySelectorAll(".option").forEach(lbl => lbl.classList.remove("selected"));
        const lbl = e.target.closest(".option");
        if (lbl) lbl.classList.add("selected");
        renderGrid();
        persist();
      });
    });
  } else if (q.type === "fill") {
    el.questionContainer.querySelectorAll("input[type=text]").forEach(input => {
      input.addEventListener("input", e => {
        const idx = parseInt(e.target.dataset.blank, 10);
        const arr = state.answers[q.id] || [];
        arr[idx] = e.target.value;
        state.answers[q.id] = arr;
        renderGrid();
        persist();
      });
    });
  }

  el.submitBtn.style.display = state.current === state.flat.length - 1 ? "" : "none";
}

/* ============= Render number grid ============= */
function renderGrid() {
  el.questionGrid.innerHTML = state.flat.map((q, i) => {
    const answered = isAnswered(q);
    const current = i === state.current;
    return `<button class="q-num ${answered ? "answered" : ""} ${current ? "current" : ""}" data-idx="${i}">${q.id}</button>`;
  }).join("");
  el.questionGrid.querySelectorAll(".q-num").forEach(b => {
    b.addEventListener("click", () => goTo(parseInt(b.dataset.idx, 10)));
  });
}

function isAnswered(q) {
  const a = state.answers[q.id];
  if (q.type === "mcq") return a !== undefined && a !== null;
  if (q.type === "fill") return Array.isArray(a) && a.some(v => (v || "").toString().trim().length > 0);
  return false;
}

/* ============= Submit ============= */
function showSubmitModal() {
  const answered = state.flat.filter(q => isAnswered(q)).length;
  const skipped = state.flat.length - answered;
  el.confirmSummary.innerHTML = `
    Answered: <strong>${answered}</strong> of ${state.flat.length}<br>
    Skipped: <strong>${skipped}</strong>
  `;
  el.confirmModal.classList.add("active");
}

function submitExam() {
  if (state.finished) return;
  state.finished = true;
  clearInterval(timerInterval);

  // Compute time used before clearing the timer key
  const endTime = parseInt(localStorage.getItem(TIMER_KEY) || "0", 10);
  const remainingMs = Math.max(0, endTime - Date.now());
  const timeUsedMin = Math.round(state.data.duration_minutes - remainingMs / 60000);
  localStorage.removeItem(TIMER_KEY);

  const results = grade();
  renderResults(results);
  sendToSheet(results, timeUsedMin);
  persist();
  switchScreen("results");
}

/* ============= Grading ============= */
function grade() {
  let totalEarned = 0;
  let totalPossible = 0;
  const sectionScores = {};
  const breakdown = [];

  // Debug — let us see what is in state.answers when grading
  console.log("[grade] state.answers =", JSON.parse(JSON.stringify(state.answers)));

  for (const section of state.data.sections) {
    sectionScores[section.id] = { earned: 0, possible: 0 };
    for (const q of section.questions) {
      const earned = scoreQuestion(q);
      if (q.type === "mcq") {
        console.log(`[grade] Q${q.id}: stored=${JSON.stringify(state.answers[q.id])} (${typeof state.answers[q.id]}) | correct=${q.correct} | earned=${earned}`);
      }
      sectionScores[section.id].earned += earned;
      sectionScores[section.id].possible += q.points;
      totalEarned += earned;
      totalPossible += q.points;
      breakdown.push({ q, earned });
    }
  }

  console.log(`[grade] Total: ${totalEarned} / ${totalPossible}`);
  return { totalEarned, totalPossible, sectionScores, breakdown };
}

/* ============= Send to Google Sheet ============= */
function sendToSheet(results, timeUsedMin) {
  if (!WEBHOOK_URL) return;

  // Build per-question answers in flat order
  const answers = state.flat.map(q => {
    const a = state.answers[q.id];
    if (q.type === "mcq") return a === undefined ? "" : "ABCD"[a];
    if (q.type === "fill") return Array.isArray(a) ? a.join(" | ") : "";
    return "";
  });

  const payload = {
    name: state.student.name,
    group: state.student.group,
    score: results.totalEarned,
    sectionA: `${results.sectionScores.A.earned} / ${results.sectionScores.A.possible}`,
    sectionB: `${results.sectionScores.B.earned} / ${results.sectionScores.B.possible}`,
    timeUsedMin: timeUsedMin,
    grade: gradeLetter(results.totalEarned, results.totalPossible),
    tabSwitches: state.tabSwitches,
    answers: answers,
  };

  // Fire-and-forget. no-cors so the request is sent even though we can't read the response.
  fetch(WEBHOOK_URL, {
    method: "POST",
    body: JSON.stringify(payload),
    mode: "no-cors",
  }).catch(err => console.error("Sheet sync failed:", err));
}

function scoreQuestion(q) {
  const a = state.answers[q.id];
  if (q.type === "mcq") {
    return a === q.correct ? q.points : 0;
  }
  if (q.type === "fill") {
    if (!Array.isArray(a)) return 0;
    let earned = 0;
    q.blanks.forEach((blank, i) => {
      const given = (a[i] || "").toString().trim();
      if (!given) return;
      const ok = blank.accepts.some(acc =>
        blank.case_sensitive ? given === acc : given.toLowerCase() === acc.toLowerCase()
      );
      if (ok) earned += blank.points;
    });
    return earned;
  }
  return 0;
}

/* ============= Render results ============= */
function renderResults({ totalEarned, totalPossible, sectionScores, breakdown }) {
  el.resultsStudent.textContent = `${state.student.name} · ${state.student.group}`;
  el.totalScore.textContent = totalEarned;
  el.sectionAScore.textContent = `${sectionScores.A.earned} / ${sectionScores.A.possible}`;
  el.sectionBScore.textContent = `${sectionScores.B.earned} / ${sectionScores.B.possible}`;

  // Pass / Fail verdict (min passing score = 65)
  const PASS_MARK = 65;
  const passFailEl = document.getElementById("pass-fail-badge");
  const failMsgEl = document.getElementById("fail-message");
  const passed = totalEarned >= PASS_MARK;
  passFailEl.textContent = passed ? "PASS" : "FAIL";
  passFailEl.className = `pass-fail ${passed ? "passed" : "failed"}`;
  if (!passed) {
    const need = PASS_MARK - totalEarned;
    failMsgEl.style.display = "block";
    failMsgEl.textContent = `You needed ${need} more point${need === 1 ? "" : "s"} to pass. Review the wrong answers below — every explanation tells you why.`;
  } else {
    failMsgEl.style.display = "none";
  }

  const grade = gradeLetter(totalEarned, totalPossible);
  el.gradeBadge.textContent = `Grade: ${grade}`;
  el.gradeBadge.className = `grade ${grade}`;

  el.breakdown.innerHTML = breakdown.map(({ q, earned }) => {
    const status = earned === q.points ? "correct" : earned === 0 ? "wrong" : "partial";
    const yourAnswer = formatStudentAnswer(q);
    const correctAnswer = formatCorrectAnswer(q);
    const icon = status === "correct" ? "✓" : status === "partial" ? "◐" : "✗";
    const label = status === "correct" ? "Correct" : status === "partial" ? "Partial" : "Wrong";

    const yourRow = `<div class="answer-row ${status === "correct" ? "your-correct" : "your-wrong"}">
        <span class="answer-tag">Your answer</span>
        <code>${yourAnswer || "— (skipped)"}</code>
      </div>`;

    const correctRow = status !== "correct" ? `<div class="answer-row your-right">
        <span class="answer-tag">Correct answer</span>
        <code>${correctAnswer}</code>
      </div>` : "";

    const whyBlock = (status !== "correct" && q.explanation)
      ? `<div class="why-block">
           <span class="why-label">💡 Why this is the right answer:</span>
           ${escape(q.explanation)}
         </div>`
      : (status === "correct" && q.explanation)
        ? `<div class="why-block small-why">${escape(q.explanation)}</div>`
        : "";

    return `
      <div class="b-row ${status}">
        <div class="b-header">
          <div class="b-num">Q${q.id} <span class="status-icon">${icon}</span></div>
          <div class="b-status-label">${label}</div>
          <div class="b-pts">${earned} / ${q.points}</div>
        </div>
        <div class="b-q-text">${escape(q.question).replace(/\n/g, "<br>")}</div>
        ${yourRow}
        ${correctRow}
        ${whyBlock}
      </div>
    `;
  }).join("");
}

function formatStudentAnswer(q) {
  const a = state.answers[q.id];
  if (q.type === "mcq") return a === undefined ? "" : `${"ABCD"[a]}) ${escape(q.options[a])}`;
  if (q.type === "fill") return Array.isArray(a) ? a.map(v => escape(v || "—")).join(" | ") : "";
  return "";
}

function formatCorrectAnswer(q) {
  if (q.type === "mcq") return `${"ABCD"[q.correct]}) ${escape(q.options[q.correct])}`;
  if (q.type === "fill") return q.blanks.map(b => b.accepts[0]).map(escape).join(" | ");
  return "";
}

function gradeLetter(earned, possible) {
  const pct = (earned / possible) * 100;
  if (pct >= 90) return "A";
  if (pct >= 80) return "B";
  if (pct >= 70) return "C";
  if (pct >= 60) return "D";
  return "F";
}

/* ============= Persistence ============= */
function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    student: state.student,
    answers: state.answers,
    current: state.current,
    finished: state.finished,
    tabSwitches: state.tabSwitches,
  }));
}

/* ============= Retake ============= */
function retake() {
  if (!confirm("Clear your answers and start again?")) return;
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(TIMER_KEY);
  location.reload();
}

/* ============= Helpers ============= */
function switchScreen(name) {
  ["welcome", "exam", "results"].forEach(n => {
    document.getElementById(n).classList.toggle("active", n === name);
  });
}

function escape(s) {
  if (s === undefined || s === null) return "";
  return s.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/* ============= Go ============= */
boot();
