/* ============================================================
   AI/ML Midterm — exam app
   Loads questions.json, renders questions, runs timer,
   autosaves to localStorage, grades on submit.
   ============================================================ */

const STORAGE_KEY = "midterm_state_v1";
const TIMER_KEY = "midterm_timer_end_v1";

const state = {
  data: null,
  flat: [],       // flat list of all questions in order
  answers: {},    // { qid: mcqIndex }  OR  { qid: [blank1, blank2] }
  current: 0,     // current question index in flat list
  student: { name: "", group: "" },
  finished: false,
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
  persist();
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
        state.answers[q.id] = parseInt(e.target.value, 10);
        renderQuestion(); // re-render to update selected highlight
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
  localStorage.removeItem(TIMER_KEY);
  grade();
  persist();
  switchScreen("results");
}

/* ============= Grading ============= */
function grade() {
  let totalEarned = 0;
  let totalPossible = 0;
  const sectionScores = {};
  const breakdown = [];

  for (const section of state.data.sections) {
    sectionScores[section.id] = { earned: 0, possible: 0 };
    for (const q of section.questions) {
      const earned = scoreQuestion(q);
      sectionScores[section.id].earned += earned;
      sectionScores[section.id].possible += q.points;
      totalEarned += earned;
      totalPossible += q.points;
      breakdown.push({ q, earned });
    }
  }

  renderResults({ totalEarned, totalPossible, sectionScores, breakdown });
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

  const grade = gradeLetter(totalEarned, totalPossible);
  el.gradeBadge.textContent = grade;
  el.gradeBadge.className = `grade ${grade}`;

  el.breakdown.innerHTML = breakdown.map(({ q, earned }) => {
    const status = earned === q.points ? "correct" : earned === 0 ? "wrong" : "partial";
    const yourAnswer = formatStudentAnswer(q);
    const correctAnswer = formatCorrectAnswer(q);
    return `
      <div class="b-row ${status}">
        <div class="b-num">${q.id}</div>
        <div class="b-q">
          <strong>${escape(q.question).replace(/\n/g, "<br>")}</strong>
          <span class="explain">
            Your answer: <code>${yourAnswer || "—"}</code>
            ${status !== "correct" ? `· Correct: <code>${correctAnswer}</code>` : ""}
            ${q.explanation ? `<br><em>${escape(q.explanation)}</em>` : ""}
          </span>
        </div>
        <div class="b-pts">${earned} / ${q.points}</div>
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
