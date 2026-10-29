(() => {
  const form = document.querySelector("#screen-form");
  const jobDescription = document.querySelector("#job-description");
  const jobCount = document.querySelector("#job-count");
  const fileInput = document.querySelector("#resume-files");
  const dropZone = document.querySelector("#drop-zone");
  const fileList = document.querySelector("#file-list");
  const analyzeButton = document.querySelector("#analyze-button");
  const statusMessage = document.querySelector("#status-message");
  const resultsList = document.querySelector("#results-list");
  const resultsCount = document.querySelector("#results-count");
  const disclaimer = document.querySelector("#results-disclaimer");
  let selectedFiles = [];

  if (window.pdfjsLib) {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  }

  jobDescription.addEventListener("input", () => {
    jobCount.textContent = `${jobDescription.value.length.toLocaleString()} / 12,000`;
  });

  fileInput.addEventListener("change", () => addFiles([...fileInput.files]));
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, e => {
    e.preventDefault(); dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, e => {
    e.preventDefault(); dropZone.classList.remove("dragging");
  }));
  dropZone.addEventListener("drop", e => addFiles([...e.dataTransfer.files]));

  function addFiles(files) {
    let rejected = [];
    for (const file of files) {
      const validType = /\.pdf$/i.test(file.name) || /\.txt$/i.test(file.name) ||
        file.type === "application/pdf" || file.type === "text/plain";
      if (!validType) { rejected.push(`${file.name}: unsupported file type`); continue; }
      if (file.size > 2 * 1024 * 1024) { rejected.push(`${file.name}: larger than 2 MB`); continue; }
      if (selectedFiles.some(existing => existing.name === file.name && existing.size === file.size)) continue;
      if (selectedFiles.length >= 5) { rejected.push(`${file.name}: maximum of five files`); continue; }
      selectedFiles.push(file);
    }
    renderFileList();
    fileInput.value = "";
    if (rejected.length) setStatus(`Some files were not added: ${rejected.join("; ")}`, "error");
    else if (selectedFiles.length) clearStatus();
  }

  function renderFileList() {
    fileList.replaceChildren();
    selectedFiles.forEach((file, index) => {
      const li = document.createElement("li");
      li.className = "file-item";
      const info = document.createElement("div"); info.className = "file-info";
      const type = document.createElement("span"); type.className = "file-type";
      type.textContent = /\.pdf$/i.test(file.name) ? "PDF" : "TXT";
      const name = document.createElement("span"); name.className = "file-name";
      name.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
      const remove = document.createElement("button"); remove.type = "button";
      remove.className = "remove-file"; remove.setAttribute("aria-label", `Remove ${file.name}`);
      remove.textContent = "×"; remove.addEventListener("click", () => {
        selectedFiles.splice(index, 1); renderFileList();
      });
      info.append(type, name); li.append(info, remove); fileList.append(li);
    });
  }

  function setStatus(message, kind = "info") {
    statusMessage.className = `status-message ${kind}`;
    statusMessage.replaceChildren();
    const p = document.createElement("p"); p.textContent = message; statusMessage.append(p);
  }
  function clearStatus() {
    statusMessage.className = "status-message";
    statusMessage.replaceChildren();
    statusMessage.hidden = true;
  }
  function loadingStatus(message) {
    statusMessage.hidden = false;
    statusMessage.className = "status-message loading";
    statusMessage.replaceChildren();
    const spinner = document.createElement("div"); spinner.className = "spinner";
    const p = document.createElement("p"); p.textContent = message;
    statusMessage.append(spinner, p);
  }

  async function extractText(file) {
    if (/\.txt$/i.test(file.name) || file.type === "text/plain") {
      return (await file.text()).trim();
    }
    if (!window.pdfjsLib) throw new Error("PDF reader did not load. Refresh the page or use a TXT file.");
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    let pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      pages.push(content.items.map(item => item.str).join(" "));
    }
    return pages.join("\n").trim();
  }

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const job = jobDescription.value.trim();
    if (job.length < 30) return setStatus("Please enter a fuller job description (at least 30 characters).", "error");
    if (!selectedFiles.length) return setStatus("Add at least one PDF or TXT resume to continue.", "error");

    analyzeButton.disabled = true;
    analyzeButton.querySelector("span:first-child").textContent = "Analyzing…";
    resultsList.replaceChildren();
    resultsCount.textContent = "Analyzing";
    disclaimer.hidden = true;
    statusMessage.hidden = false;
    let completed = 0, failures = [];

    try {
      for (const file of selectedFiles) {
        loadingStatus(`Reading and analyzing ${file.name} (${completed + 1} of ${selectedFiles.length})…`);
        try {
          const resumeText = await extractText(file);
          if (resumeText.length < 80) throw new Error("Very little text was extracted. This may be a scanned PDF; try a text-based PDF or TXT file.");
          if (resumeText.length > 25000) throw new Error("Extracted resume text exceeds 25,000 characters. Shorten the file and retry.");

          const response = await fetch("/api/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jobDescription: job, resumeText })
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error || `Analysis failed (${response.status}).`);
          renderCandidate(file.name, payload.result);
          completed++;
        } catch (error) {
          failures.push(`${file.name}: ${error.message || "Unknown error"}`);
        }
      }
      statusMessage.hidden = true;
      resultsCount.textContent = `${completed} candidate${completed === 1 ? "" : "s"}`;
      disclaimer.hidden = completed === 0;
      if (completed === 0) {
        setStatus(`No resumes could be analyzed. ${failures.join(" | ")}`, "error");
      } else if (failures.length) {
        setStatus(`Completed ${completed} analysis/analyses. Some files failed: ${failures.join(" | ")}`, "error");
      } else {
        setStatus(`Successfully analyzed ${completed} resume${completed === 1 ? "" : "s"}.`, "info");
      }
    } finally {
      analyzeButton.disabled = false;
      analyzeButton.querySelector("span:first-child").textContent = "Analyze resumes";
    }
  });

  function addText(parent, tag, text, className) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = text || "";
    parent.append(el);
    return el;
  }
  function renderTags(parent, values, className = "tag") {
    const list = document.createElement("div"); list.className = "tag-list";
    (Array.isArray(values) ? values : []).forEach(value => {
      const tag = document.createElement("span"); tag.className = className; tag.textContent = String(value);
      list.append(tag);
    });
    if (!list.childElementCount) addText(list, "span", "None identified", "candidate-subtitle");
    parent.append(list);
  }
  function renderList(parent, values, className = "evidence-list") {
    const list = document.createElement("ul"); list.className = className;
    (Array.isArray(values) ? values : []).forEach(value => addText(list, "li", String(value)));
    if (!list.childElementCount) addText(list, "li", "No items returned.");
    parent.append(list);
  }
  function section(parent, heading, content, renderFn) {
    const wrap = document.createElement("div"); wrap.className = "result-section";
    addText(wrap, "h4", heading);
    renderFn(wrap, content);
    parent.append(wrap);
  }
  function renderCandidate(filename, result) {
    const card = document.createElement("article"); card.className = "candidate-card";
    const top = document.createElement("div"); top.className = "candidate-top";
    const heading = document.createElement("div");
    addText(heading, "div", result.candidate_label || filename, "candidate-title");
    addText(heading, "div", filename, "candidate-subtitle");
    const score = document.createElement("div"); score.className = "score-chip";
    score.append(document.createTextNode(`${Number.isFinite(result.match_score) ? result.match_score : "—"}`));
    addText(score, "small", "/ 100");
    top.append(heading, score); card.append(top);
    addText(card, "p", result.summary || "No summary provided.", "candidate-summary");
    section(card, "Evidence-backed matches", result.matching_requirements, (p,v) => renderList(p,v));
    section(card, "Skills evidenced", result.skills_found, (p,v) => renderTags(p,v));
    section(card, "Requirements not demonstrated", result.gaps, (p,v) => renderTags(p,v,"tag gap"));
    section(card, "Follow-up questions", result.follow_up_questions, (p,v) => renderList(p,v,"question-list"));
    const details = document.createElement("details");
    addText(details, "summary", "Review limitations & fairness checks");
    addText(details, "p", result.caveats || "Verify every claim against the original resume. Missing evidence is not proof that a candidate lacks a skill.", "candidate-summary");
    card.append(details);
    resultsList.append(card);
  }
})();
