const state = {
  file: null,
  mediaId: null,
  words: [],
  selection: null,
  stitchSelections: [],
  queue: [],
  clipLibrary: [],
  autoSuggestions: [],
  activeClipId: null,
  processingQueue: false,
  activeItemId: null,
};

const videoInput = document.getElementById("video-input");
const transcribeButton = document.getElementById("transcribe-button");
const statusEl = document.getElementById("status");
const transcriptEl = document.getElementById("transcript");
const sourceVideoEl = document.getElementById("source-video");
const clipVideoEl = document.getElementById("clip-video");
const contextMenuEl = document.getElementById("context-menu");
const selectionPillEl = document.getElementById("selection-pill");
const captionsEnabledEl = document.getElementById("captions-enabled");
const captionFontSizeEl = document.getElementById("caption-font-size");
const captionFontSizeValueEl = document.getElementById("caption-font-size-value");
const captionPositionEl = document.getElementById("caption-position");
const captionVerticalPercentEl = document.getElementById("caption-vertical-percent");
const captionVerticalPercentValueEl = document.getElementById("caption-vertical-percent-value");
const captionWordsPerEl = document.getElementById("caption-words-per");
const captionWordsPerValueEl = document.getElementById("caption-words-per-value");
const exportPresetEl = document.getElementById("export-preset");
const customExportSizeEl = document.getElementById("custom-export-size");
const exportWidthEl = document.getElementById("export-width");
const exportHeightEl = document.getElementById("export-height");
const exportZoomEl = document.getElementById("export-zoom");
const exportZoomValueEl = document.getElementById("export-zoom-value");
const clipQueueEl = document.getElementById("clip-queue");
const stitchBuilderEl = document.getElementById("stitch-builder");
const queueStitchedClipEl = document.getElementById("queue-stitched-clip");
const clearStitchedClipEl = document.getElementById("clear-stitched-clip");
const latestClipActionsEl = document.getElementById("latest-clip-actions");
const latestClipDownloadEl = document.getElementById("latest-clip-download");
const latestClipViewLibraryEl = document.getElementById("latest-clip-view-library");
const latestClipCopyPathEl = document.getElementById("latest-clip-copy-path");
const clipLibraryEl = document.getElementById("clip-library");
const downloadAllClipsEl = document.getElementById("download-all-clips");
const generateAutoClipsEl = document.getElementById("generate-auto-clips");
const queueAllAutoClipsEl = document.getElementById("queue-all-auto-clips");
const autoClipSuggestionsEl = document.getElementById("auto-clip-suggestions");

const captionPositionPercents = {
  top: 16,
  middle_top: 30,
  middle: 50,
  middle_bottom: 64,
  bottom: 78,
};

captionFontSizeEl.addEventListener("input", () => {
  captionFontSizeValueEl.textContent = captionFontSizeEl.value;
});

captionWordsPerEl.addEventListener("input", () => {
  captionWordsPerValueEl.textContent = captionWordsPerEl.value;
});

captionVerticalPercentEl.addEventListener("input", () => {
  captionVerticalPercentValueEl.textContent = `${captionVerticalPercentEl.value}%`;
});

captionPositionEl.addEventListener("change", () => {
  const value = captionPositionPercents[captionPositionEl.value];
  if (value) {
    captionVerticalPercentEl.value = value;
    captionVerticalPercentValueEl.textContent = `${value}%`;
  }
});

exportPresetEl.addEventListener("change", () => {
  const isCustom = exportPresetEl.value === "custom";
  customExportSizeEl.classList.toggle("hidden", !isCustom);

  if (exportPresetEl.value === "landscape") {
    exportWidthEl.value = 1920;
    exportHeightEl.value = 1080;
  } else if (exportPresetEl.value === "portrait") {
    exportWidthEl.value = 1080;
    exportHeightEl.value = 1920;
  } else if (exportPresetEl.value === "square") {
    exportWidthEl.value = 1080;
    exportHeightEl.value = 1080;
  }
});

exportZoomEl.addEventListener("input", () => {
  exportZoomValueEl.textContent = `${exportZoomEl.value}%`;
});

clipQueueEl.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-queue-action]");
  if (!button) return;

  const action = button.dataset.queueAction;
  const itemId = button.dataset.itemId;
  const item = state.queue.find((entry) => entry.id === itemId);
  if (!item) return;

  if (action === "cancel") {
    cancelQueueItem(itemId);
    return;
  }

  if (action === "retry") {
    retryQueueItem(itemId);
    return;
  }

  if (action === "open-folder" && item.clipId) {
    selectClipInLibrary(item.clipId);
    return;
  }

  if (action === "copy-folder" && item.folderPath) {
    await copyFolderPath(item.folderPath);
    return;
  }

  if (action === "download" && item.clipUrl) {
    downloadClip(item);
  }
});

stitchBuilderEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stitch-remove]");
  if (!button) return;
  removeStitchSelection(button.dataset.stitchRemove);
});

clipLibraryEl.addEventListener("click", async (event) => {
  const selectButton = event.target.closest("[data-library-select]");
  if (selectButton) {
    selectClipInLibrary(selectButton.dataset.librarySelect);
    return;
  }

  const downloadButton = event.target.closest("[data-library-download]");
  if (downloadButton) {
    const clip = state.clipLibrary.find((item) => item.clipId === downloadButton.dataset.libraryDownload);
    if (clip) {
      downloadClip(clip);
    }
    return;
  }

  const copyButton = event.target.closest("[data-library-copy]");
  if (copyButton) {
    const clip = state.clipLibrary.find((item) => item.clipId === copyButton.dataset.libraryCopy);
    if (clip?.folderPath) {
      await copyFolderPath(clip.folderPath);
    }
  }
});

autoClipSuggestionsEl.addEventListener("click", (event) => {
  const queueButton = event.target.closest("[data-auto-queue]");
  if (queueButton) {
    queueAutoSuggestion(queueButton.dataset.autoQueue);
    return;
  }

  const previewButton = event.target.closest("[data-auto-preview]");
  if (previewButton) {
    previewAutoSuggestion(previewButton.dataset.autoPreview);
  }
});

queueStitchedClipEl.addEventListener("click", () => {
  queueStitchedClip();
});

clearStitchedClipEl.addEventListener("click", () => {
  state.stitchSelections = [];
  renderStitchBuilder();
  setStatus("Cleared the stitch builder.");
});

generateAutoClipsEl.addEventListener("click", async () => {
  await generateAutoClips();
});

queueAllAutoClipsEl.addEventListener("click", () => {
  if (!state.autoSuggestions.length) {
    setStatus("Generate auto-clip suggestions first.");
    return;
  }
  state.autoSuggestions.forEach((suggestion) => {
    enqueueClipJob([selectionEntryFromSuggestion(suggestion)], false);
  });
  setStatus(`Queued ${state.autoSuggestions.length} suggested clips.`);
});

latestClipViewLibraryEl.addEventListener("click", () => {
  if (!state.activeClipId) {
    setStatus("No rendered clip is selected yet.");
    return;
  }
  selectClipInLibrary(state.activeClipId);
  clipLibraryEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
});

latestClipCopyPathEl.addEventListener("click", async () => {
  const item = state.clipLibrary.find((entry) => entry.clipId === state.activeClipId) || [...state.clipLibrary].reverse()[0];
  if (!item) {
    setStatus("No finished clip folder path is available yet.");
    return;
  }
  await copyFolderPath(item.folderPath);
});

downloadAllClipsEl.addEventListener("click", () => {
  if (!state.clipLibrary.length) {
    setStatus("No rendered clips are available to download.");
    return;
  }
  state.clipLibrary.forEach((clip, index) => {
    window.setTimeout(() => downloadClip(clip), index * 180);
  });
  setStatus(`Started downloads for ${state.clipLibrary.length} clips.`);
});

videoInput.addEventListener("change", () => {
  state.file = videoInput.files?.[0] ?? null;
  transcribeButton.disabled = !state.file;
  if (state.file) {
    sourceVideoEl.src = URL.createObjectURL(state.file);
    setStatus(`Ready to transcribe ${state.file.name}`);
  }
});

transcribeButton.addEventListener("click", async () => {
  if (!state.file) return;
  const form = new FormData();
  form.append("file", state.file);

  setStatus("Transcribing with Whisper base. This can take a minute on longer videos.");
  transcribeButton.disabled = true;

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) {
    setStatus(payload.detail || "Transcription failed.");
    transcribeButton.disabled = false;
    return;
  }

  state.mediaId = payload.media_id;
  state.words = payload.words;
  state.selection = null;
  state.stitchSelections = [];
  state.clipLibrary = [];
  state.autoSuggestions = [];
  state.activeClipId = null;
  renderTranscript();
  renderStitchBuilder();
  renderClipLibrary();
  renderAutoClipSuggestions();
  updateSelectionPill();
  setStatus("Transcript ready. Highlight text and right-click to queue or stitch clips.");
  transcribeButton.disabled = false;
});

transcriptEl.addEventListener("contextmenu", (event) => {
  const selection = getSelectedWordIds();
  if (!selection) {
    hideContextMenu();
    return;
  }
  state.selection = selection;
  updateSelectionPill();
  event.preventDefault();
  showContextMenu(event.clientX, event.clientY);
});

document.addEventListener("click", () => {
  hideContextMenu();
});

document.addEventListener("selectionchange", () => {
  const selection = getSelectedWordIds();
  state.selection = selection;
  updateSelectionPill();
});

contextMenuEl.addEventListener("click", (event) => {
  const action = event.target.dataset.action;
  if (!action || !state.selection) return;
  hideContextMenu();

  if (action === "remove") {
    updateRemovedState(true);
    renderTranscript();
    renderStitchBuilder();
    return;
  }

  if (action === "stitch") {
    addSelectionToStitch();
    return;
  }

  if (action === "clip") {
    queueClipFromSelection();
  }
});

function updateRemovedState(removed) {
  const { startId, endId } = state.selection;
  const indices = sortedIndices(startId, endId);
  for (let index = indices.start; index <= indices.end; index += 1) {
    state.words[index].removed = removed;
  }
  setStatus(removed ? "Selected words removed from the transcript." : "Selection restored.");
}

function addSelectionToStitch() {
  if (!state.mediaId || !state.selection) return;
  const selectionData = buildSelectionData(state.selection);
  if (!selectionData) return;

  state.stitchSelections.push(selectionData);
  state.stitchSelections.sort((a, b) => a.range.start - b.range.start);
  renderStitchBuilder();
  setStatus(`Added "${selectionData.label}" to the stitch builder.`);
}

function buildSelectionData(selection) {
  const range = sortedIndices(selection.startId, selection.endId);
  const selectedWords = state.words.slice(range.start, range.end + 1).filter((word) => !word.removed);
  if (!selectedWords.length) {
    setStatus("That selection only contains removed words.");
    return null;
  }

  return {
    id: crypto.randomUUID(),
    selection: {
      start_word_id: selection.startId,
      end_word_id: selection.endId,
    },
    range,
    label: buildClipLabel(selectedWords),
    preview: selectedWords.slice(0, 8).map((word) => word.text).join(" "),
  };
}

function queueClipFromSelection() {
  if (!state.mediaId || !state.selection) return;
  const selectionData = buildSelectionData(state.selection);
  if (!selectionData) return;
  enqueueClipJob([selectionData], false);
}

function queueStitchedClip() {
  if (!state.stitchSelections.length) {
    setStatus("Add at least one selection to the stitch builder first.");
    return;
  }
  enqueueClipJob(state.stitchSelections, true);
  state.stitchSelections = [];
  renderStitchBuilder();
}

function enqueueClipJob(selectionEntries, stitched) {
  const queueItem = {
    id: crypto.randomUUID(),
    mediaId: state.mediaId,
    words: JSON.parse(JSON.stringify(state.words)),
    selection: selectionEntries[0].selection,
    selections: selectionEntries.map((entry) => entry.selection),
    captions: currentCaptionSettings(),
    export: currentExportSettings(),
    label: buildQueueLabel(selectionEntries, stitched),
    status: "queued",
    error: null,
    clipUrl: null,
    stitched,
  };

  state.queue.push(queueItem);
  renderQueue();
  setStatus(`Queued "${queueItem.label}" for rendering.`);
  void processQueue();
}

async function generateAutoClips() {
  if (!state.mediaId || !state.words.length) {
    setStatus("Transcribe a video first so Klippy has transcript data to score.");
    return;
  }

  setStatus("Generating auto-clip suggestions from transcript, scenes, and semantic scoring.");
  const response = await fetch("/api/auto-clips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      media_id: state.mediaId,
      words: state.words,
      target_count: 5,
      min_duration: 15,
      max_duration: 45,
    }),
  });
  const payload = await response.json();
  if (!response.ok) {
    setStatus(payload.detail || "Auto-clipping failed.");
    return;
  }

  state.autoSuggestions = payload.clips || [];
  renderAutoClipSuggestions();
  setStatus(state.autoSuggestions.length ? `Generated ${state.autoSuggestions.length} suggested clips.` : "No good clip suggestions were found.");
}

function selectionEntryFromSuggestion(suggestion) {
  const range = sortedIndices(suggestion.start_word_id, suggestion.end_word_id);
  return {
    id: suggestion.id,
    selection: {
      start_word_id: suggestion.start_word_id,
      end_word_id: suggestion.end_word_id,
    },
    range,
    label: suggestion.title,
    preview: suggestion.preview,
  };
}

function queueAutoSuggestion(suggestionId) {
  const suggestion = state.autoSuggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return;
  enqueueClipJob([selectionEntryFromSuggestion(suggestion)], false);
}

function previewAutoSuggestion(suggestionId) {
  const suggestion = state.autoSuggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return;
  const start = state.words.findIndex((word) => word.id === suggestion.start_word_id);
  const end = state.words.findIndex((word) => word.id === suggestion.end_word_id);
  if (start >= 0 && end >= 0) {
    state.selection = {
      startId: state.words[Math.min(start, end)].id,
      endId: state.words[Math.max(start, end)].id,
    };
    updateSelectionPill();
  }
  sourceVideoEl.currentTime = suggestion.start;
  sourceVideoEl.play().catch(() => {});
  setStatus(`Previewing suggested clip "${suggestion.title}".`);
}

function currentCaptionSettings() {
  return {
    enabled: captionsEnabledEl.checked,
    font_size: Number(captionFontSizeEl.value),
    position: captionPositionEl.value,
    vertical_percent: Number(captionVerticalPercentEl.value),
    words_per_caption: Number(captionWordsPerEl.value),
  };
}

function currentExportSettings() {
  return {
    preset: exportPresetEl.value,
    width: Number(exportWidthEl.value),
    height: Number(exportHeightEl.value),
    zoom: Number(exportZoomEl.value) / 100,
  };
}

async function processQueue() {
  if (state.processingQueue) return;
  state.processingQueue = true;

  while (true) {
    const nextItem = state.queue.find((item) => item.status === "queued");
    if (!nextItem) break;

    state.activeItemId = nextItem.id;
    nextItem.status = "rendering";
    renderQueue();
    setStatus(`Rendering "${nextItem.label}" and adding captions.`);

    const response = await fetch("/api/clips", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        media_id: nextItem.mediaId,
        words: nextItem.words,
        selection: nextItem.selection,
        selections: nextItem.selections,
        captions: nextItem.captions,
        export: nextItem.export,
      }),
    });
    const payload = await response.json();

    if (!response.ok) {
      nextItem.status = "error";
      nextItem.error = payload.detail || "Clip creation failed.";
      state.activeItemId = null;
      setStatus(nextItem.error);
      renderQueue();
      continue;
    }

    nextItem.status = "done";
    nextItem.clipId = payload.clip_id;
    nextItem.clipUrl = payload.clip_url;
    nextItem.fileName = payload.file_name;
    nextItem.folderPath = payload.folder_path;
    nextItem.label = payload.clip_name || nextItem.label;
    state.activeItemId = null;
    syncClipIntoLibrary(nextItem);
    selectClipInLibrary(nextItem.clipId);
    setStatus(`Finished "${nextItem.label}".`);
    renderQueue();
  }

  state.activeItemId = null;
  state.processingQueue = false;
}

function renderStitchBuilder() {
  stitchBuilderEl.innerHTML = "";

  if (!state.stitchSelections.length) {
    stitchBuilderEl.innerHTML = '<p class="empty-queue">No stitch segments yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.stitchSelections.forEach((item, index) => {
    const wrapper = document.createElement("div");
    wrapper.className = "queue-item";

    const header = document.createElement("div");
    header.className = "queue-item-header";

    const title = document.createElement("p");
    title.className = "queue-item-title";
    title.textContent = `Part ${index + 1}: ${item.label}`;

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "queue-action";
    remove.dataset.stitchRemove = item.id;
    remove.textContent = "Remove";

    header.appendChild(title);
    header.appendChild(remove);

    const meta = document.createElement("p");
    meta.className = "queue-item-meta";
    meta.textContent = item.preview;

    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    fragment.appendChild(wrapper);
  });

  stitchBuilderEl.appendChild(fragment);
}

function renderAutoClipSuggestions() {
  autoClipSuggestionsEl.innerHTML = "";

  if (!state.autoSuggestions.length) {
    autoClipSuggestionsEl.innerHTML = '<p class="empty-queue">No auto-clip suggestions yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.autoSuggestions.forEach((suggestion) => {
    const wrapper = document.createElement("div");
    wrapper.className = "queue-item";

    const header = document.createElement("div");
    header.className = "queue-item-header";

    const title = document.createElement("p");
    title.className = "queue-item-title";
    title.textContent = suggestion.title;

    const queueButton = document.createElement("button");
    queueButton.type = "button";
    queueButton.className = "queue-action";
    queueButton.dataset.autoQueue = suggestion.id;
    queueButton.textContent = "Queue";

    header.appendChild(title);
    header.appendChild(queueButton);

    const meta = document.createElement("p");
    meta.className = "queue-item-meta";
    meta.textContent = `${suggestion.start.toFixed(1)}s - ${suggestion.end.toFixed(1)}s • ${suggestion.preview}`;

    const score = document.createElement("p");
    score.className = "queue-item-score";
    score.textContent = `Score ${suggestion.score.toFixed(2)}`;

    const reasons = document.createElement("p");
    reasons.className = "queue-item-reasons";
    reasons.textContent = suggestion.reasons.join(" • ");

    const actions = document.createElement("div");
    actions.className = "queue-item-actions";
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.className = "queue-action";
    previewButton.dataset.autoPreview = suggestion.id;
    previewButton.textContent = "Preview";
    actions.appendChild(previewButton);

    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    wrapper.appendChild(score);
    wrapper.appendChild(reasons);
    wrapper.appendChild(actions);
    fragment.appendChild(wrapper);
  });

  autoClipSuggestionsEl.appendChild(fragment);
}

function removeStitchSelection(stitchId) {
  state.stitchSelections = state.stitchSelections.filter((item) => item.id !== stitchId);
  renderStitchBuilder();
  setStatus("Removed that segment from the stitch builder.");
}

function renderQueue() {
  clipQueueEl.innerHTML = "";

  if (!state.queue.length) {
    clipQueueEl.innerHTML = '<p class="empty-queue">No clips queued yet.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  state.queue.forEach((item) => {
    const wrapper = document.createElement("div");
    wrapper.className = "queue-item";

    const header = document.createElement("div");
    header.className = "queue-item-header";

    const title = document.createElement("p");
    title.className = "queue-item-title";
    title.textContent = item.label;

    const badge = document.createElement("span");
    badge.className = `queue-badge ${item.status}`;
    badge.textContent = item.status;

    header.appendChild(title);
    header.appendChild(badge);

    const meta = document.createElement("p");
    meta.className = "queue-item-meta";
    meta.textContent = item.error
      ? item.error
      : `${item.stitched ? "Stitched" : "Single"} • ${formatExportLabel(item.export)} • ${formatCaptionLabel(item.captions)}`;

    const actions = document.createElement("div");
    actions.className = "queue-item-actions";

    if (item.status === "queued") {
      actions.appendChild(buildQueueAction("Cancel", "cancel", item.id));
    }

    if (item.status === "error") {
      actions.appendChild(buildQueueAction("Retry", "retry", item.id));
    }

    if (item.status === "done") {
      if (item.clipUrl) {
        actions.appendChild(buildQueueLinkAction("Download", item.clipUrl, item.fileName || `${item.label}.mp4`, true));
      }
      if (item.clipId) {
        actions.appendChild(buildQueueAction("View In Library", "open-folder", item.id));
      }
      actions.appendChild(buildQueueAction("Copy Folder Path", "copy-folder", item.id));
    }

    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    if (actions.childElementCount) {
      wrapper.appendChild(actions);
    }
    fragment.appendChild(wrapper);
  });

  clipQueueEl.appendChild(fragment);
}

function buildQueueAction(label, action, itemId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "queue-action";
  button.dataset.queueAction = action;
  button.dataset.itemId = itemId;
  button.textContent = label;
  return button;
}

function buildQueueLinkAction(label, href, downloadName, isDownload) {
  const link = document.createElement("a");
  link.className = "queue-action";
  link.href = href;
  link.textContent = label;
  if (isDownload) {
    link.download = downloadName || "";
  } else {
    link.target = "_blank";
    link.rel = "noreferrer";
  }
  return link;
}

function updateLatestClipActions(item) {
  if (!item?.clipUrl) {
    latestClipActionsEl.classList.add("hidden");
    return;
  }

  latestClipDownloadEl.href = item.clipUrl;
  latestClipDownloadEl.download = item.fileName || `${item.label}.mp4`;
  latestClipActionsEl.classList.remove("hidden");
}

function syncClipIntoLibrary(item) {
  const clip = {
    clipId: item.clipId,
    label: item.label,
    clipUrl: item.clipUrl,
    fileName: item.fileName,
    folderPath: item.folderPath,
    stitched: item.stitched,
    export: item.export,
    captions: item.captions,
  };
  const existingIndex = state.clipLibrary.findIndex((entry) => entry.clipId === clip.clipId);
  if (existingIndex >= 0) {
    state.clipLibrary[existingIndex] = clip;
  } else {
    state.clipLibrary.unshift(clip);
  }
  renderClipLibrary();
}

function renderClipLibrary() {
  clipLibraryEl.innerHTML = "";

  if (!state.clipLibrary.length) {
    clipLibraryEl.innerHTML = '<p class="empty-queue">No rendered clips yet.</p>';
    latestClipActionsEl.classList.add("hidden");
    return;
  }

  const fragment = document.createDocumentFragment();
  state.clipLibrary.forEach((clip) => {
    const wrapper = document.createElement("div");
    wrapper.className = `queue-item ${clip.clipId === state.activeClipId ? "active" : ""}`;

    const header = document.createElement("div");
    header.className = "queue-item-header";

    const title = document.createElement("p");
    title.className = "queue-item-title";
    title.textContent = clip.label;

    const selectButton = document.createElement("button");
    selectButton.type = "button";
    selectButton.className = "queue-action";
    selectButton.dataset.librarySelect = clip.clipId;
    selectButton.textContent = clip.clipId === state.activeClipId ? "Viewing" : "Preview";

    header.appendChild(title);
    header.appendChild(selectButton);

    const meta = document.createElement("p");
    meta.className = "queue-item-meta";
    meta.textContent = `${clip.stitched ? "Stitched" : "Single"} • ${formatExportLabel(clip.export)} • ${formatCaptionLabel(clip.captions)}`;

    const actions = document.createElement("div");
    actions.className = "queue-item-actions";
    actions.appendChild(buildLibraryAction("Download", "download", clip.clipId));
    actions.appendChild(buildLibraryAction("Copy Folder Path", "copy", clip.clipId));

    wrapper.appendChild(header);
    wrapper.appendChild(meta);
    wrapper.appendChild(actions);
    fragment.appendChild(wrapper);
  });

  clipLibraryEl.appendChild(fragment);
}

function buildLibraryAction(label, action, clipId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "queue-action";
  if (action === "download") {
    button.dataset.libraryDownload = clipId;
  } else if (action === "copy") {
    button.dataset.libraryCopy = clipId;
  }
  button.textContent = label;
  return button;
}

function selectClipInLibrary(clipId) {
  const clip = state.clipLibrary.find((entry) => entry.clipId === clipId);
  if (!clip) return;
  state.activeClipId = clipId;
  clipVideoEl.src = `${clip.clipUrl}?v=${Date.now()}`;
  clipVideoEl.load();
  updateLatestClipActions(clip);
  renderClipLibrary();
  setStatus(`Viewing "${clip.label}" in the clip library.`);
}

function renderTranscript() {
  transcriptEl.innerHTML = "";
  const fragment = document.createDocumentFragment();
  state.words.forEach((word, index) => {
    const span = document.createElement("span");
    span.className = `word ${word.removed ? "removed" : ""}`;
    span.dataset.wordId = word.id;
    span.dataset.index = String(index);
    span.textContent = word.text;
    fragment.appendChild(span);
    fragment.appendChild(document.createTextNode(" "));
  });
  transcriptEl.appendChild(fragment);
}

function buildClipLabel(words) {
  const text = words
    .map((word) => word.text.replace(/^[^\w]+|[^\w]+$/g, ""))
    .filter(Boolean)
    .slice(0, 3)
    .join(" ");
  return text || "Clip";
}

function buildQueueLabel(selectionEntries, stitched) {
  if (!stitched) return selectionEntries[0].label;
  const first = selectionEntries[0]?.label || "Clip";
  return `${first} stitch`;
}

function formatExportLabel(exportSettings) {
  let baseLabel = `${exportSettings.width}x${exportSettings.height}`;
  if (exportSettings.preset === "portrait") baseLabel = "Reels 9:16";
  if (exportSettings.preset === "square") baseLabel = "Square 1:1";
  if (exportSettings.preset === "landscape") baseLabel = "YouTube 16:9";

  const zoomPercent = Math.round((exportSettings.zoom ?? 1) * 100);
  return zoomPercent === 100 ? baseLabel : `${baseLabel} • ${zoomPercent}% zoom`;
}

function formatCaptionLabel(captions) {
  return captions.enabled ? `Captions • ${captions.position.replace("_", " ")}` : "No captions";
}

function cancelQueueItem(itemId) {
  const item = state.queue.find((entry) => entry.id === itemId);
  if (!item) return;
  if (item.status !== "queued") return;

  state.queue = state.queue.filter((entry) => entry.id !== itemId);
  renderQueue();
  setStatus(`Removed "${item.label}" from the queue.`);
}

function retryQueueItem(itemId) {
  const item = state.queue.find((entry) => entry.id === itemId);
  if (!item) return;

  item.status = "queued";
  item.error = null;
  renderQueue();
  setStatus(`Queued "${item.label}" for another render attempt.`);
  void processQueue();
}

async function copyFolderPath(folderPath) {
  try {
    await navigator.clipboard.writeText(folderPath);
    setStatus(`Copied folder path: ${folderPath}`);
  } catch (error) {
    setStatus(`Folder path: ${folderPath}`);
  }
}

function showContextMenu(x, y) {
  contextMenuEl.style.left = `${x}px`;
  contextMenuEl.style.top = `${y}px`;
  contextMenuEl.classList.remove("hidden");
}

function hideContextMenu() {
  contextMenuEl.classList.add("hidden");
}

function setStatus(message) {
  statusEl.textContent = message;
}

function getSelectedWordIds() {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const wordElements = [...transcriptEl.querySelectorAll(".word")].filter((element) =>
    range.intersectsNode(element),
  );

  if (!wordElements.length) {
    return null;
  }

  return {
    startId: wordElements[0].dataset.wordId,
    endId: wordElements[wordElements.length - 1].dataset.wordId,
  };
}

function sortedIndices(startId, endId) {
  const start = state.words.findIndex((word) => word.id === startId);
  const end = state.words.findIndex((word) => word.id === endId);
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function updateSelectionPill() {
  if (!state.selection) {
    selectionPillEl.textContent = "No selection";
    return;
  }
  const { start, end } = sortedIndices(state.selection.startId, state.selection.endId);
  const activeWords = state.words
    .slice(start, end + 1)
    .filter((word) => !word.removed)
    .map((word) => word.text);
  selectionPillEl.textContent = activeWords.length
    ? `${activeWords.length} selected words`
    : "Selection only contains removed words";
}
