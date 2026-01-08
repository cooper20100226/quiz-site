/* =========================
   可擴充題庫測驗系統
   - 題庫：question-bank/bank.json
   - 支援：來源篩選、難度、隨機、即時解析、錯題回顧、匯出錯題
========================= */

const BANK_URL = "question-bank/bank.json";

const el = (id) => document.getElementById(id);

const state = {
  bank: null,
  filtered: [],
  quizList: [],
  idx: 0,
  correct: 0,
  wrong: [],
  startedAt: null,
  timer: null,
  seconds: 0,
  settings: {
    source: "ALL",
    difficulty: "ALL",
    count: 10,
    mode: "RANDOM",
    shuffleOptions: true,
    showExplain: true,
    allowReview: true
  }
};

function escapeHtml(str){
  return String(str)
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function shuffle(arr){
  const a = arr.slice();
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(sec){
  const m = Math.floor(sec/60);
  const s = sec%60;
  return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}

async function loadBank(){
  try{
    el("loadStatus").textContent = "載入題庫中…";
    const res = await fetch(BANK_URL, { cache: "no-store" });
    if(!res.ok) throw new Error(`HTTP ${res.status}`);
    const bank = await res.json();
    if(!bank || !Array.isArray(bank.questions)) throw new Error("題庫格式錯誤：缺少 questions[]");
    state.bank = bank;
    buildSourceFilter();
    el("loadStatus").textContent = `✅ 題庫載入完成：${bank.questions.length} 題（${bank.meta?.title || "未命名"}）`;
  }catch(err){
    console.error(err);
    el("loadStatus").textContent = `❌ 題庫載入失敗：${err.message}（請確認 ${BANK_URL} 路徑與 JSON 格式）`;
  }
}

function buildSourceFilter(){
  const sel = el("filterSource");
  const sources = new Set(state.bank.questions.map(q => q.source || "未分類"));
  const list = ["ALL", ...Array.from(sources).sort((a,b)=>a.localeCompare(b,"zh-Hant"))];
  sel.innerHTML = list.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s==="ALL"?"全部":s)}</option>`).join("");
}

function readSettings(){
  state.settings.source = el("filterSource").value || "ALL";
  state.settings.difficulty = el("filterDifficulty").value || "ALL";
  state.settings.count = Math.max(1, parseInt(el("questionCount").value || "10", 10));
  state.settings.mode = el("mode").value || "RANDOM";
  state.settings.shuffleOptions = el("toggleShuffleOptions").checked;
  state.settings.showExplain = el("toggleShowExplain").checked;
  state.settings.allowReview = el("toggleAllowReview").checked;
}

function applyFilters(){
  if(!state.bank) return [];
  let qs = state.bank.questions.slice();

  if(state.settings.source !== "ALL"){
    qs = qs.filter(q => (q.source || "未分類") === state.settings.source);
  }
  if(state.settings.difficulty !== "ALL"){
    const d = parseInt(state.settings.difficulty, 10);
    qs = qs.filter(q => Number(q.difficulty) === d);
  }

  return qs;
}

function pickQuizList(){
  state.filtered = applyFilters();
  let list = state.filtered.slice();

  if(state.settings.mode === "RANDOM"){
    list = shuffle(list);
  }

  list = list.slice(0, Math.min(state.settings.count, list.length));
  return list;
}

function startTimer(){
  stopTimer();
  state.seconds = 0;
  el("timerText").textContent = fmtTime(0);
  state.timer = setInterval(()=>{
    state.seconds++;
    el("timerText").textContent = fmtTime(state.seconds);
  }, 1000);
}
function stopTimer(){
  if(state.timer){
    clearInterval(state.timer);
    state.timer = null;
  }
}

function showSection(which){
  el("quizCard").classList.add("hidden");
  el("resultCard").classList.add("hidden");
  if(which === "quiz") el("quizCard").classList.remove("hidden");
  if(which === "result") el("resultCard").classList.remove("hidden");
}

function setProgress(){
  const total = state.quizList.length;
  const cur = state.idx + 1;
  el("progressText").textContent = `${cur}/${total}`;
  el("progressFill").style.width = `${(cur/Math.max(total,1))*100}%`;
}

function renderQuestion(){
  const q = state.quizList[state.idx];
  if(!q){
    finishQuiz();
    return;
  }

  setProgress();
  el("feedback").classList.add("hidden");
  el("btnNext").classList.add("hidden");

  el("qSource").textContent = `來源：${q.source || "未分類"}`;
  el("qDifficulty").textContent = `難度：${q.difficulty ?? "-"}`;
  el("qTags").textContent = (q.tags && q.tags.length) ? `標籤：${q.tags.join(" / ")}` : "標籤：-";
  el("qStem").textContent = q.stem;

  const isMulti = (q.type === "multi");
  const optionsWrap = el("options");

  // 建立選項索引映射（用於選項亂序後仍可對答案）
  let optionIndices = q.options.map((_, idx)=>idx);
  if(state.settings.shuffleOptions){
    optionIndices = shuffle(optionIndices);
  }

  optionsWrap.innerHTML = optionIndices.map((origIdx, i)=>{
    const letter = String.fromCharCode(65 + i);
    const text = q.options[origIdx];
    return `
      <button class="option" data-orig="${origIdx}" data-i="${i}">
        <strong>${letter}.</strong> ${escapeHtml(text)}
      </button>
    `;
  }).join("");

  // 作答狀態
  let chosen = [];
  const locked = { v:false };

  const optionButtons = Array.from(optionsWrap.querySelectorAll(".option"));
  optionButtons.forEach(btn=>{
    btn.addEventListener("click", ()=>{
      if(locked.v) return;

      const orig = parseInt(btn.dataset.orig, 10);
      if(isMulti){
        // 多選：點一下 toggle
        if(chosen.includes(orig)){
          chosen = chosen.filter(x=>x!==orig);
          btn.classList.remove("wrong", "correct");
        }else{
          chosen.push(orig);
          btn.classList.add("wrong"); // 先用 wrong 表示「已選」的視覺；結束後再校正
        }
      }else{
        chosen = [orig];
        locked.v = true;
        gradeAndShow(q, chosen, optionButtons);
      }
    });
  });

  // 多選題需要一個「送出」按鈕（動態插入到 feedback 區上方比較順）
  if(isMulti){
    const submit = document.createElement("button");
    submit.className = "btn primary";
    submit.textContent = "送出答案";
    submit.style.marginTop = "10px";
    submit.addEventListener("click", ()=>{
      if(locked.v) return;
      locked.v = true;
      gradeAndShow(q, chosen, optionButtons);
    });

    // 如果已存在，先移除
    const old = el("quizCard").querySelector(".multi-submit");
    if(old) old.remove();
    submit.classList.add("multi-submit");
    el("options").insertAdjacentElement("afterend", submit);
  }else{
    const old = el("quizCard").querySelector(".multi-submit");
    if(old) old.remove();
  }
}

function sameSet(a, b){
  const A = [...a].sort((x,y)=>x-y);
  const B = [...b].sort((x,y)=>x-y);
  if(A.length !== B.length) return false;
  for(let i=0;i<A.length;i++){
    if(A[i] !== B[i]) return false;
  }
  return true;
}

function gradeAndShow(q, chosen, optionButtons){
  const ans = Array.isArray(q.answer) ? q.answer : [];
  const correct = sameSet(chosen, ans);

  // 標示正確/錯誤
  optionButtons.forEach(btn=>{
    const orig = parseInt(btn.dataset.orig, 10);
    btn.classList.remove("wrong", "correct");
    if(ans.includes(orig)) btn.classList.add("correct");
    if(chosen.includes(orig) && !ans.includes(orig)) btn.classList.add("wrong");
    btn.disabled = true;
  });

  if(correct){
    state.correct++;
  }else{
    state.wrong.push({
      id: q.id,
      source: q.source,
      difficulty: q.difficulty,
      tags: q.tags,
      type: q.type,
      stem: q.stem,
      options: q.options,
      answer: q.answer,
      explain: q.explain,
      chosen
    });
  }

  const fb = el("feedback");
  if(state.settings.showExplain){
    fb.classList.remove("hidden");
    fb.classList.toggle("ok", correct);
    fb.classList.toggle("bad", !correct);

    const title = correct ? "✅ 正確" : "❌ 錯誤";
    const why = q.explain?.why || "（此題尚未提供解析）";
    const optLines = (q.explain?.options && q.explain.options.length)
      ? `<ul>${q.explain.options.map(x=>`<li>${escapeHtml(x)}</li>`).join("")}</ul>`
      : "";

    fb.innerHTML = `
      <h4>${title}</h4>
      <p>${escapeHtml(why)}</p>
      ${optLines}
    `;
  }

  el("btnNext").classList.remove("hidden");
}

function nextQuestion(){
  state.idx++;
  if(state.idx >= state.quizList.length){
    finishQuiz();
  }else{
    renderQuestion();
  }
}

function finishQuiz(){
  stopTimer();
  showSection("result");

  const total = state.quizList.length;
  const wrong = total - state.correct;
  const acc = total ? Math.round((state.correct/total)*100) : 0;

  el("resultSummary").textContent =
    `共 ${total} 題｜正確 ${state.correct}｜錯誤 ${wrong}｜正確率 ${acc}%｜作答時間 ${fmtTime(state.seconds)}`;

  if(state.settings.allowReview && state.wrong.length){
    el("reviewBlock").classList.remove("hidden");
    renderWrongList();
  }else{
    el("reviewBlock").classList.add("hidden");
  }
}

function renderWrongList(){
  const wrap = el("wrongList");
  wrap.innerHTML = state.wrong.map((w, idx)=>{
    const ans = (w.answer || []).map(i => w.options[i]).join(" / ");
    const cho = (w.chosen || []).map(i => w.options[i]).join(" / ");
    const why = w.explain?.why || "（此題尚未提供解析）";
    return `
      <div class="wrong-item">
        <div class="muted">#${idx+1} ｜來源：${escapeHtml(w.source || "未分類")} ｜難度：${escapeHtml(String(w.difficulty ?? "-"))}</div>
        <div style="margin-top:6px;font-weight:800;">${escapeHtml(w.stem)}</div>
        <div style="margin-top:6px;"><b>你的答案：</b>${escapeHtml(cho || "（未作答）")}</div>
        <div style="margin-top:4px;"><b>正確答案：</b>${escapeHtml(ans || "（未設定）")}</div>
        <div style="margin-top:8px;"><b>解析：</b>${escapeHtml(why)}</div>
      </div>
    `;
  }).join("");
}

function resetQuiz(){
  state.filtered = [];
  state.quizList = [];
  state.idx = 0;
  state.correct = 0;
  state.wrong = [];
  state.startedAt = null;
  stopTimer();
}

function startQuiz(){
  if(!state.bank){
    alert("題庫尚未載入，請先確認 bank.json 是否存在且格式正確。");
    return;
  }
  readSettings();

  const list = pickQuizList();
  if(list.length === 0){
    alert("篩選後沒有任何題目。請改選來源/難度，或先載入示範題。");
    return;
  }

  resetQuiz();
  state.quizList = list;
  state.startedAt = new Date();

  showSection("quiz");
  startTimer();
  renderQuestion();
}

function quitQuiz(){
  if(confirm("確定要結束測驗？")){
    finishQuiz();
  }
}

function exportWrong(){
  if(!state.wrong.length){
    alert("目前沒有錯題可匯出。");
    return;
  }
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), wrong: state.wrong }, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "wrong-questions.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function loadDemoQuestions(){
  // 若 bank.json 載入失敗，也可用 demo 快速試跑
  state.bank = state.bank || { meta:{ title:"Demo Bank" }, questions: [] };

  const hasDemo = state.bank.questions.some(q => String(q.id||"").startsWith("demo-"));
  if(hasDemo){
    alert("示範題已存在題庫中。");
    return;
  }

  const demo = [
    {
      id: "demo-003",
      source: "PDF3_示範",
      difficulty: 2,
      tags: ["計算", "考點"],
      type: "single",
      stem: "BPS 通常代表什麼？",
      options: ["Bytes Per Second", "Bits Per Second", "Base Packet System", "Binary Protocol Service"],
      answer: [1],
      explain: {
        why: "BPS 一般指 Bits Per Second（每秒位元數），用來描述網速。",
        options: [
          "❌ 這是 B/s 的概念",
          "✅ 正確",
          "❌ 不是標準用語",
          "❌ 不是標準用語"
        ]
      }
    }
  ];

  state.bank.questions.push(...demo);
  buildSourceFilter();
  el("loadStatus").textContent = `✅ 已加入示範題：目前 ${state.bank.questions.length} 題`;
}

function bindUI(){
  el("btnStart").addEventListener("click", startQuiz);
  el("btnNext").addEventListener("click", nextQuestion);
  el("btnQuit").addEventListener("click", quitQuiz);
  el("btnRestart").addEventListener("click", ()=>{
    showSection(null);
    el("resultCard").classList.add("hidden");
    el("quizCard").classList.add("hidden");
    // 回到設定區
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  el("btnExportWrong").addEventListener("click", exportWrong);

  el("btnReload").addEventListener("click", async ()=>{
    await loadBank();
  });

  el("btnDemoFill").addEventListener("click", ()=>{
    loadDemoQuestions();
  });
}

(async function init(){
  bindUI();
  await loadBank();
})();
