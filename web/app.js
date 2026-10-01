(() => {
  const $ = (selector) => document.querySelector(selector);
  const ui = {
    nav: $("#library-nav"),
    search: $("#search-input"),
    refresh: $("#refresh-button"),
    totalCount: $("#total-count"),
    title: $("#content-title"),
    subtitle: $("#content-subtitle"),
    breadcrumb: $("#breadcrumb"),
    jumpForm: $("#jump-form"),
    jumpInput: $("#jump-input"),
    notice: $("#notice"),
    trackList: $("#track-list"),
    visibleCount: $("#visible-count"),
    nowTitle: $("#now-title"),
    nowFile: $("#now-file"),
    elapsed: $("#elapsed-time"),
    duration: $("#duration-time"),
    seek: $("#seek-bar"),
    playPause: $("#play-pause-button"),
    playPauseLabel: $("#play-pause-label"),
    replay: $("#replay-button"),
    heard: $("#heard-button"),
    audio: $("#audio-element"),
  };

  function readListenedTracks() {
    try {
      const saved = JSON.parse(localStorage.getItem("powerup-audio-listened") || "[]");
      return Array.isArray(saved) ? saved.filter((id) => typeof id === "string") : [];
    } catch (_) {
      return [];
    }
  }

  const state = {
    books: [],
    activeDiscKey: "",
    selectedId: "",
    query: "",
    listened: new Set(readListenedTracks()),
    expandedBooks: new Set(["Pupil's Book", "Activity Book"]),
    duration: 0,
  };

  const icons = {
    chevron: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>',
    disc: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.7"/><circle cx="8" cy="8" r="1.5"/></svg>',
    play: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.2 2.8v10.4L13 8z"/></svg>',
  };

  function escapeHTML(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  function allTracks() {
    return state.books.flatMap((book) => book.discs.flatMap((disc) => disc.tracks));
  }

  function discKey(book, disc) { return book + "::" + disc; }

  function activeDisc() {
    for (const book of state.books) {
      const disc = book.discs.find((item) => discKey(book.name, item.name) === state.activeDiscKey);
      if (disc) return { book, disc };
    }
    return null;
  }

  function selectedTrack() {
    return allTracks().find((track) => track.id === state.selectedId) || null;
  }

  function saveSelection() {
    try {
      localStorage.setItem("powerup-audio-selection", JSON.stringify({
        activeDiscKey: state.activeDiscKey,
        selectedId: state.selectedId,
      }));
    } catch (_) { /* Browser storage may be disabled. */ }
  }

  function saveListenedTracks() {
    try {
      localStorage.setItem("powerup-audio-listened", JSON.stringify(Array.from(state.listened)));
    } catch (_) { /* Browser storage may be disabled. */ }
  }

  function toggleListened() {
    const track = selectedTrack();
    if (!track) return;
    if (state.listened.has(track.id)) state.listened.delete(track.id);
    else state.listened.add(track.id);
    saveListenedTracks();
    renderList();
    renderPlayer();
  }

  function restoreSelection() {
    try {
      const saved = JSON.parse(localStorage.getItem("powerup-audio-selection") || "null");
      if (!saved) return;
      if (state.books.some((book) => book.discs.some((disc) => discKey(book.name, disc.name) === saved.activeDiscKey))) {
        state.activeDiscKey = saved.activeDiscKey;
      }
      if (allTracks().some((track) => track.id === saved.selectedId)) state.selectedId = saved.selectedId;
    } catch (_) { /* Ignore malformed or inaccessible saved state. */ }
  }

  function setNotice(message, type = "") {
    ui.notice.textContent = message || "";
    ui.notice.hidden = !message;
    ui.notice.classList.toggle("error", type === "error");
  }

  async function loadLibrary({ quiet = false } = {}) {
    ui.refresh.classList.add("is-loading");
    ui.refresh.disabled = true;
    if (!quiet) setNotice("");
    try {
      const response = await fetch("/api/library", { cache: "no-store" });
      if (!response.ok) throw new Error("读取音频目录失败");
      const library = await response.json();
      const previousSelected = state.selectedId;
      const previousDisc = state.activeDiscKey;
      state.books = Array.isArray(library.books) ? library.books : [];
      const tracks = allTracks();
      if (tracks.length === 0) {
        state.activeDiscKey = "";
        state.selectedId = "";
        state.duration = 0;
        ui.audio.pause();
        ui.audio.removeAttribute("src");
        ui.audio.dataset.trackId = "";
        ui.audio.load();
        render();
        setNotice("没有找到符合命名格式的 MP3。请检查 audios 目录中的教材文件夹和文件名。", "error");
        return;
      }
      const validIds = new Set(tracks.map((track) => track.id));
      let removedStaleState = false;
      for (const id of state.listened) {
        if (!validIds.has(id)) {
          state.listened.delete(id);
          removedStaleState = true;
        }
      }
      if (removedStaleState) saveListenedTracks();
      state.activeDiscKey = previousDisc;
      state.selectedId = previousSelected;
      restoreSelection();
      if (!activeDisc()) {
        const firstBook = state.books.find((book) => book.discs.length > 0);
        state.activeDiscKey = discKey(firstBook.name, firstBook.discs[0].name);
      }
      if (!selectedTrack()) {
        const current = activeDisc();
        state.selectedId = current && current.disc.tracks.length ? current.disc.tracks[0].id : tracks[0].id;
      }
      render();
      const current = selectedTrack();
      if (current && ui.audio.dataset.trackId !== current.id) setSelected(current);
      if (quiet) setNotice("目录已刷新。");
    } catch (error) {
      setNotice((error.message || "连接播放器失败") + "。请确认容器正在运行，并检查 audios 目录。", "error");
      ui.trackList.innerHTML = '<tr><td colspan="3" class="empty-cell">暂时无法读取音频目录</td></tr>';
    } finally {
      ui.refresh.classList.remove("is-loading");
      ui.refresh.disabled = false;
    }
  }

  function renderNav() {
    if (!state.books.length) {
      ui.nav.innerHTML = '<div class="loading-state">目录中还没有可播放的曲目。</div>';
      return;
    }
    ui.nav.innerHTML = state.books.map((book) => {
      const expanded = state.expandedBooks.has(book.name);
      const discs = book.discs.map((disc) => {
        const key = discKey(book.name, disc.name);
        const active = key === state.activeDiscKey;
        return '<button class="disc-toggle' + (active ? " active" : "") + '" type="button" data-book="' + escapeHTML(book.name) + '" data-disc="' + escapeHTML(disc.name) + '" aria-pressed="' + active + '">' +
          '<span class="disc-icon">' + icons.disc + '</span><span>' + escapeHTML(disc.name) + '</span><span class="disc-track-count">' + disc.count + '</span>' +
          '</button>';
      }).join("");
      return '<section class="book-section">' +
        '<button class="book-toggle" type="button" data-toggle-book="' + escapeHTML(book.name) + '" aria-expanded="' + expanded + '">' +
        '<span class="chevron">' + icons.chevron + '</span><span class="book-name">' + escapeHTML(book.name) + '</span><span class="book-count">' + book.count + '</span>' +
        '</button>' + (expanded ? '<div class="disc-list">' + discs + '</div>' : "") + '</section>';
    }).join("");
  }

  function filteredTracks() {
    const query = state.query.trim().toLocaleLowerCase();
    if (query) {
      if (/^\d+$/.test(query)) {
        const exactNumber = Number(query);
        return orderListenedLast(allTracks().filter((track) => track.number === exactNumber));
      }
      const trackNumberQuery = query.match(/^track\s*(\d+)$/);
      if (trackNumberQuery) {
        const exactNumber = Number(trackNumberQuery[1]);
        return orderListenedLast(allTracks().filter((track) => track.number === exactNumber));
      }
      return orderListenedLast(allTracks().filter((track) => [
        track.book, track.disc, "track " + track.number, String(track.number), track.fileName,
      ].join(" ").toLocaleLowerCase().includes(query)));
    }
    const current = activeDisc();
    return orderListenedLast(current ? current.disc.tracks : []);
  }

  function orderListenedLast(tracks) {
    return tracks.slice().sort((a, b) => Number(state.listened.has(a.id)) - Number(state.listened.has(b.id)));
  }

  function renderList() {
    const selected = selectedTrack();
    const current = activeDisc();
    const tracks = filteredTracks();
    const total = allTracks().length;
    ui.totalCount.textContent = String(total);

    if (state.query.trim()) {
      ui.breadcrumb.innerHTML = 'POWER UP <span>/</span> SEARCH';
      ui.title.textContent = "搜索结果";
      ui.subtitle.textContent = "匹配曲目、教材、CD 或文件名";
      ui.jumpForm.hidden = true;
    } else if (current) {
      ui.breadcrumb.innerHTML = "POWER UP <span>/</span> " + escapeHTML(current.book.name.toUpperCase()) + " <span>/</span> " + escapeHTML(current.disc.name);
      ui.title.textContent = current.book.name + " / " + current.disc.name;
      ui.subtitle.textContent = current.disc.count + " 首曲目 · 按 Track 编号排序";
      ui.jumpForm.hidden = false;
      ui.jumpInput.max = String(current.disc.tracks.length || 1);
      ui.jumpInput.placeholder = "1–" + current.disc.tracks.length;
    } else {
      ui.breadcrumb.innerHTML = 'POWER UP <span>/</span> AUDIO';
      ui.title.textContent = "音频目录";
      ui.subtitle.textContent = "从左侧目录选择教材与 CD";
      ui.jumpForm.hidden = false;
    }

    if (!tracks.length) {
      const message = state.query.trim() ? "没有找到匹配的曲目" : "这个 CD 暂无曲目";
      ui.trackList.innerHTML = '<tr><td colspan="3" class="empty-cell">' + message + "</td></tr>";
      ui.visibleCount.textContent = "0 首曲目";
      return;
    }

    ui.trackList.innerHTML = tracks.map((track) => {
      const isSelected = track.id === (selected ? selected.id : "");
      const isPlaying = isSelected && !ui.audio.paused;
      const isHeard = state.listened.has(track.id);
      return '<tr class="' + (isSelected ? "selected" : "") + (isPlaying ? " is-playing" : "") + '" data-track-row="' + track.id + '" aria-current="' + isSelected + '">' +
        '<td><div class="track-cell">' + (isSelected ? '<span class="track-live" aria-hidden="true"></span>' : '<span class="track-live is-hidden" aria-hidden="true"></span>') + '<span class="track-index">Track ' + track.number + '</span>' + (isHeard ? '<span class="heard-badge">已听</span>' : "") + '</div></td>' +
        '<td class="file-name" title="' + escapeHTML(track.fileName) + '">' + escapeHTML(track.fileName) + "</td>" +
        '<td><button class="row-play" type="button" data-play-track="' + track.id + '" aria-label="播放 Track ' + track.number + '">' + icons.play + "</button></td>" +
        "</tr>";
    }).join("");
    ui.visibleCount.textContent = state.query.trim() ? tracks.length + " / " + total + " 首曲目" : tracks.length + " 首曲目";
  }

  function renderPlayer() {
    const track = selectedTrack();
    const enabled = Boolean(track);
    const isPlaying = enabled && !ui.audio.paused;
    const isHeard = enabled && state.listened.has(track.id);
    ui.playPause.disabled = !enabled;
    ui.playPause.classList.toggle("is-playing", isPlaying);
    ui.playPauseLabel.textContent = isPlaying ? "暂停" : "开始";
    ui.playPause.setAttribute("aria-label", isPlaying ? "暂停" : "开始");
    ui.playPause.setAttribute("aria-pressed", String(isPlaying));
    ui.replay.disabled = !enabled;
    ui.heard.disabled = !enabled;
    ui.heard.classList.toggle("is-marked", isHeard);
    ui.heard.setAttribute("aria-pressed", String(isHeard));
    ui.heard.setAttribute("aria-label", isHeard ? "取消已听标记" : "标记为已听");
    ui.heard.title = isHeard ? "取消已听标记" : "标记为已听";
    ui.seek.disabled = !enabled || !state.duration;
    ui.nowTitle.textContent = track ? track.book + " · " + track.disc + " · Track " + track.number : "尚未选择曲目";
    ui.nowFile.textContent = track ? track.fileName : "从目录中选择一首音频";
    ui.elapsed.textContent = formatTime(ui.audio.currentTime || 0);
    ui.duration.textContent = state.duration ? formatTime(state.duration) : "--:--";
    ui.seek.max = String(state.duration || 0);
    ui.seek.value = String(Math.min(ui.audio.currentTime || 0, state.duration || 0));
    updateSeekFill();
  }

  function render() {
    renderNav();
    renderList();
    renderPlayer();
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
    const whole = Math.floor(seconds);
    const minutes = Math.floor(whole / 60);
    const remaining = whole % 60;
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return hours + ":" + String(minutes % 60).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
    return String(minutes).padStart(2, "0") + ":" + String(remaining).padStart(2, "0");
  }

  function updateSeekFill() {
    const percentage = state.duration ? Math.min(100, (ui.audio.currentTime / state.duration) * 100) : 0;
    ui.seek.style.setProperty("--seek-progress", percentage + "%");
  }

  function setSelected(track, { autoplay = false } = {}) {
    if (!track) return;
    const changed = state.selectedId !== track.id;
    state.selectedId = track.id;
    state.activeDiscKey = discKey(track.book, track.disc);
    state.expandedBooks.add(track.book);
    setNotice("");
    if (changed || ui.audio.dataset.trackId !== track.id) {
      ui.audio.pause();
      ui.audio.src = "/api/audio/" + encodeURIComponent(track.id);
      ui.audio.dataset.trackId = track.id;
      ui.audio.load();
      state.duration = 0;
    }
    saveSelection();
    render();
    if (autoplay) playCurrent();
  }

  async function playCurrent() {
    if (!selectedTrack()) return;
    try {
      if (ui.audio.ended) ui.audio.currentTime = 0;
      await ui.audio.play();
      setNotice("");
    } catch (error) {
      if (error.name === "NotAllowedError") {
        setNotice('浏览器阻止了播放，请再按一次“开始”。', "error");
      } else {
        setNotice("这首音频暂时无法播放，请检查文件是否完整。", "error");
      }
    }
  }

  ui.nav.addEventListener("click", (event) => {
    const toggle = event.target.closest("[data-toggle-book]");
    if (toggle) {
      const name = toggle.dataset.toggleBook;
      if (state.expandedBooks.has(name)) state.expandedBooks.delete(name);
      else state.expandedBooks.add(name);
      renderNav();
      return;
    }
    const discButton = event.target.closest("[data-disc]");
    if (discButton) {
      state.activeDiscKey = discKey(discButton.dataset.book, discButton.dataset.disc);
      state.query = "";
      ui.search.value = "";
      const current = activeDisc();
      if (current && current.disc.tracks.length) setSelected(current.disc.tracks[0]);
      else { saveSelection(); render(); }
    }
  });

  ui.trackList.addEventListener("click", (event) => {
    const playButton = event.target.closest("[data-play-track]");
    if (playButton) {
      const track = allTracks().find((item) => item.id === playButton.dataset.playTrack);
      setSelected(track, { autoplay: true });
      return;
    }
    const row = event.target.closest("[data-track-row]");
    if (row) {
      const track = allTracks().find((item) => item.id === row.dataset.trackRow);
      setSelected(track);
    }
  });

  ui.search.addEventListener("input", () => {
    state.query = ui.search.value;
    renderList();
  });

  ui.jumpForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const current = activeDisc();
    const number = Number(ui.jumpInput.value);
    if (!current || !Number.isInteger(number) || number < 1) {
      setNotice("请输入当前 CD 中有效的曲目编号。", "error");
      ui.jumpInput.focus();
      return;
    }
    const track = current.disc.tracks.find((item) => item.number === number);
    if (!track) {
      setNotice(current.disc.name + " 中没有 Track " + number + "。", "error");
      ui.jumpInput.focus();
      return;
    }
    setNotice("");
    state.query = "";
    ui.search.value = "";
    setSelected(track);
    requestAnimationFrame(() => {
      const row = document.querySelector('[data-track-row="' + track.id + '"]');
      if (row) row.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  });

  ui.playPause.addEventListener("click", () => {
    if (ui.audio.paused) playCurrent();
    else ui.audio.pause();
  });
  ui.heard.addEventListener("click", toggleListened);
  ui.replay.addEventListener("click", async () => {
    if (!selectedTrack()) return;
    try { ui.audio.currentTime = 0; } catch (_) { /* Metadata may still be loading. */ }
    await playCurrent();
  });
  ui.seek.addEventListener("input", () => {
    ui.elapsed.textContent = formatTime(Number(ui.seek.value));
  });
  ui.seek.addEventListener("change", () => {
    if (state.duration) ui.audio.currentTime = Number(ui.seek.value);
  });
  ui.refresh.addEventListener("click", () => loadLibrary({ quiet: true }));

  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      ui.search.focus();
      return;
    }
    if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
      event.preventDefault();
      ui.search.focus();
    }
  });

  ui.audio.addEventListener("loadedmetadata", () => {
    state.duration = Number.isFinite(ui.audio.duration) ? ui.audio.duration : 0;
    renderPlayer();
  });
  ui.audio.addEventListener("durationchange", () => {
    if (Number.isFinite(ui.audio.duration)) state.duration = ui.audio.duration;
    renderPlayer();
  });
  ui.audio.addEventListener("timeupdate", renderPlayer);
  ui.audio.addEventListener("play", () => { renderPlayer(); renderList(); });
  ui.audio.addEventListener("pause", () => { renderPlayer(); renderList(); });
  ui.audio.addEventListener("ended", () => { renderPlayer(); renderList(); });
  ui.audio.addEventListener("error", () => {
    if (ui.audio.dataset.trackId) setNotice("读取音频失败。请刷新目录，或确认该 MP3 文件仍在 audios 文件夹中。", "error");
  });

  loadLibrary();
})();
