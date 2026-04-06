// ============================================
// VARIABLES
// ============================================
let currentTaskText = '';
let currentUrl = '';

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const taskPreview = document.getElementById('taskPreview');
const taskPreviewContent = document.getElementById('taskPreviewContent');
const askAIBtn = document.getElementById('askAIBtn');
const refreshBtn = document.getElementById('refreshBtn');
const copyTaskBtn = document.getElementById('copyTaskBtn');

const optRingkasan = document.getElementById('optRingkasan');
const optPenjelasan = document.getElementById('optPenjelasan');
const optLangkah = document.getElementById('optLangkah');
const optTips = document.getElementById('optTips');
const optDeepThink = document.getElementById('optDeepThink');

const aiRadios = document.querySelectorAll('input[name="aiProvider"]');

const fileInput = document.getElementById('fileInput');
const uploadBtn = document.getElementById('uploadBtn');
const uploadStatus = document.getElementById('uploadStatus');

// ============================================
// OPTIONS MANAGEMENT
// ============================================
function saveOptions() {
  let aiProvider = 'deepseek';
  for (let radio of aiRadios) {
    if (radio.checked) { aiProvider = radio.value; break; }
  }
  const options = {
    aiProvider: aiProvider,
    ringkasan: optRingkasan.checked,
    penjelasan: optPenjelasan.checked,
    langkah: optLangkah.checked,
    tips: optTips.checked,
    deepthink: optDeepThink.checked
  };
  chrome.storage.local.set({ userOptions: options });
}

function loadOptions() {
  chrome.storage.local.get(['userOptions'], (result) => {
    if (result.userOptions) {
      for (let radio of aiRadios) {
        if (radio.value === result.userOptions.aiProvider) { radio.checked = true; break; }
      }
      optRingkasan.checked = result.userOptions.ringkasan !== false;
      optPenjelasan.checked = result.userOptions.penjelasan !== false;
      optLangkah.checked = result.userOptions.langkah !== false;
      optTips.checked = result.userOptions.tips !== false;
      optDeepThink.checked = result.userOptions.deepthink || false;
    }
  });
}

for (let radio of aiRadios) radio.addEventListener('change', saveOptions);
optRingkasan.addEventListener('change', saveOptions);
optPenjelasan.addEventListener('change', saveOptions);
optLangkah.addEventListener('change', saveOptions);
optTips.addEventListener('change', saveOptions);
optDeepThink.addEventListener('change', saveOptions);

// ============================================
// TASK UI
// ============================================
function extractUrlFromTaskText(taskText) {
  if (!taskText) return '';
  const sourceMatch = taskText.match(/【Sumber】:\s*(https?:\/\/[^\s\n]+)/);
  if (sourceMatch) return sourceMatch[1];
  const urlMatch = taskText.match(/(https?:\/\/[^\s\n]+)/);
  return urlMatch ? urlMatch[1] : '';
}

function updateTaskUI(taskText) {
  currentTaskText = taskText;
  currentUrl = extractUrlFromTaskText(taskText);
  
  if (currentUrl || (taskText && taskText.length > 50)) {
    statusDot.className = 'status-dot success';
    // Status di atas: File terdeteksi!
    statusText.textContent = `✓ File terdeteksi!`;
    askAIBtn.disabled = false;
    // Preview di bawah: Tetap "File terdeteksi" (tidak tampilkan nama file)
    taskPreviewContent.textContent = 'File terdeteksi';
    taskPreview.style.display = 'block';
  } else {
    statusDot.className = 'status-dot error';
    statusText.textContent = '✗ Belum ada file. Klik "🤖 Tanya AI" di halaman LMS.';
    askAIBtn.disabled = true;
    taskPreview.style.display = 'none';
  }
}

async function loadTaskText() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['currentTaskText'], (result) => {
      const taskText = result.currentTaskText || '';
      updateTaskUI(taskText);
      resolve(!!taskText);
    });
  });
}

async function refreshTask() {
  statusDot.className = 'status-dot loading';
  statusText.textContent = '🔄 Memuat ulang...';
  askAIBtn.disabled = true;
  taskPreview.style.display = 'none';
  
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url.includes('elearning.universitasmandiri.ac.id')) {
      statusDot.className = 'status-dot error';
      statusText.textContent = '✗ Buka halaman LMS terlebih dahulu';
      askAIBtn.disabled = true;
      return;
    }
    await chrome.tabs.sendMessage(tab.id, { action: 'refreshTask' }).catch(() => {});
    setTimeout(async () => { await loadTaskText(); }, 1500);
  } catch (error) {
    statusDot.className = 'status-dot error';
    statusText.textContent = 'Error: ' + error.message;
    askAIBtn.disabled = true;
  }
}

// ============================================
// ASK AI
// ============================================
async function askAI() {
  if (!currentTaskText || currentTaskText.length < 50) {
    alert('Belum ada konten file. Silakan:\n1. Buka halaman LMS\n2. Klik tombol "🤖 Tanya AI" di samping file\n3. Lalu klik "Tanya AI!" di popup ini');
    return;
  }
  
  let aiProvider = 'deepseek';
  for (let radio of aiRadios) {
    if (radio.checked) { aiProvider = radio.value; break; }
  }
  
  const selectedOptions = [];
  if (optRingkasan.checked) selectedOptions.push('ringkasan');
  if (optPenjelasan.checked) selectedOptions.push('penjelasan');
  if (optLangkah.checked) selectedOptions.push('langkah');
  if (optTips.checked) selectedOptions.push('tips');
  const deepThinkEnabled = optDeepThink.checked;
  
  if (selectedOptions.length === 0) {
    alert('Pilih setidaknya satu pertanyaan.');
    return;
  }
  
  askAIBtn.textContent = '⏳ Membuka AI...';
  askAIBtn.disabled = true;
  
  try {
    const response = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { 
          action: 'askAI',
          taskText: currentTaskText,
          taskUrl: currentUrl,
          aiProvider: aiProvider,
          options: selectedOptions,
          deepThink: deepThinkEnabled
        },
        (response) => resolve(response || {})
      );
    });
    if (response && response.warning) alert(response.warning);
    window.close();
  } catch (error) {
    alert('Error: ' + error.message);
    askAIBtn.textContent = 'Tanya AI!';
    askAIBtn.disabled = false;
  }
}

async function copyTaskText() {
  if (!currentUrl) {
    alert('Tidak ada URL untuk disalin');
    return;
  }
  try {
    await navigator.clipboard.writeText(currentUrl);
    copyTaskBtn.textContent = '✅';
    setTimeout(() => { copyTaskBtn.textContent = '📋'; }, 2000);
  } catch (err) {
    alert('Gagal menyalin: ' + err.message);
  }
}

// ============================================
// FILE UPLOAD (Manual - alternatif)
// ============================================
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

async function extractPdfTextFromBlob(blob) {
  if (typeof pdfjsLib === 'undefined') {
    await loadScript('libs/pdf.js');
    pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.js');
  }
  const url = URL.createObjectURL(blob);
  try {
    const loadingTask = pdfjsLib.getDocument(url);
    const pdf = await loadingTask.promise;
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n--- Halaman ${i} ---\n${pageText}\n`;
    }
    return fullText.trim();
  } catch (err) {
    return `Gagal membaca PDF: ${err.message}`;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractDocxText(blob) {
  if (typeof mammoth === 'undefined') await loadScript('libs/mammoth.browser.min.js');
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || 'Tidak ada teks yang diekstrak dari DOCX.';
}

async function extractXlsxText(blob) {
  if (typeof XLSX === 'undefined') await loadScript('libs/xlsx.full.min.js');
  const arrayBuffer = await blob.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  let fullText = '';
  workbook.SheetNames.forEach(sheetName => {
    const sheet = workbook.Sheets[sheetName];
    const sheetText = XLSX.utils.sheet_to_txt(sheet);
    fullText += `\n--- Sheet: ${sheetName} ---\n${sheetText}\n`;
  });
  return fullText.trim() || 'Tidak ada teks dari file Excel.';
}

async function extractPptxText(blob) {
  if (typeof JSZip === 'undefined') await loadScript('libs/jszip.min.js');
  const zip = await JSZip.loadAsync(blob);
  const slideFiles = Object.keys(zip.files).filter(name => name.match(/ppt\/slides\/slide\d+\.xml/));
  let fullText = '';
  for (const slideFile of slideFiles) {
    const xmlString = await zip.files[slideFile].async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
    const textNodes = xmlDoc.getElementsByTagName('a:t');
    let slideText = '';
    for (let node of textNodes) slideText += node.textContent + ' ';
    if (slideText.trim()) fullText += `\n--- Slide ${slideFile.match(/\d+/)?.[0] || '?'} ---\n${slideText.trim()}\n`;
  }
  return fullText.trim() || 'Tidak ada teks dari presentasi.';
}

async function handleFileUpload(file) {
  if (!file) return;
  uploadStatus.textContent = `⏳ Memproses ${file.name} ...`;
  uploadStatus.style.color = '#4facfe';

  let extractedText = '';
  const ext = file.name.split('.').pop().toLowerCase();

  try {
    if (ext === 'pdf') extractedText = await extractPdfTextFromBlob(file);
    else if (ext === 'docx') extractedText = await extractDocxText(file);
    else if (ext === 'xlsx') extractedText = await extractXlsxText(file);
    else if (ext === 'pptx') extractedText = await extractPptxText(file);
    else {
      uploadStatus.textContent = '❌ Format tidak didukung.';
      uploadStatus.style.color = '#ef4444';
      return;
    }

    if (extractedText && extractedText.length > 30) {
      const taskText = `【Judul】: ${file.name}\n\n【Sumber】: Uploaded file (${file.name})\n\n【Konten】:\n${extractedText}`;
      await chrome.storage.local.set({ currentTaskText: taskText });
      updateTaskUI(taskText);
      uploadStatus.textContent = `✅ Berhasil! ${file.name} siap dikirim.`;
      uploadStatus.style.color = '#10b981';
      setTimeout(() => { uploadStatus.textContent = ''; }, 3000);
    } else {
      uploadStatus.textContent = `⚠️ Tidak dapat mengekstrak teks dari ${file.name}.`;
      uploadStatus.style.color = '#f59e0b';
    }
  } catch (err) {
    uploadStatus.textContent = `❌ Error: ${err.message}`;
    uploadStatus.style.color = '#ef4444';
  }
}

// ============================================
// EVENT LISTENERS
// ============================================
uploadBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) handleFileUpload(e.target.files[0]);
  fileInput.value = '';
});

askAIBtn.addEventListener('click', askAI);
refreshBtn.addEventListener('click', refreshTask);
copyTaskBtn.addEventListener('click', copyTaskText);

// ============================================
// INIT
// ============================================
document.addEventListener('DOMContentLoaded', () => {
  loadTaskText();
  loadOptions();
});

// Listen untuk update dari content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'taskUpdated' && request.taskText) {
    updateTaskUI(request.taskText);
  }
  if (request.action === 'fileExtracted') {
    loadTaskText();
  }
});