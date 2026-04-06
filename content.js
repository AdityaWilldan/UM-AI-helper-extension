console.log('AI LMS Helper: Content script loaded');

// ============================================
// PDF.js Setup
// ============================================
if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.js');
  console.log('PDF.js loaded successfully');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function isPdfPage() {
  const url = window.location.href.toLowerCase();
  return url.includes('.pdf') || document.contentType === 'application/pdf';
}

function isTugasPage() {
  const url = window.location.href.toLowerCase();
  const keywords = ['tugas', 'assignment', 'penugasan', 'materi', 'latihan', 'pdf'];
  const title = document.title.toLowerCase();
  return keywords.some(keyword => url.includes(keyword) || title.includes(keyword));
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL(src);
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function cleanText(text) {
  if (!text) return '';
  const removePatterns = [
    /login|logout|dashboard|profile|settings|copyright|all rights reserved|powered by/gi,
    /\n\s*\n\s*\n/g,
    /[^\w\s\.,!?;:()\-=+*/%$#@&<>\[\]{}"'\n]/g
  ];
  let cleaned = text;
  removePatterns.forEach(pattern => {
    cleaned = cleaned.replace(pattern, ' ');
  });
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  return cleaned;
}

// ============================================
// PDF EXTRACTION
// ============================================
async function extractTextFromPdfWithPdfJs(pdfUrl) {
  console.log('Membaca PDF dengan PDF.js dari:', pdfUrl);
  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    const pdf = await loadingTask.promise;
    console.log(`PDF loaded, jumlah halaman: ${pdf.numPages}`);
    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      console.log(`Membaca halaman ${i}...`);
      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += `\n--- Halaman ${i} ---\n${pageText}\n`;
    }
    return cleanText(fullText);
  } catch (error) {
    console.error('Gagal membaca PDF dengan PDF.js:', error);
    return `Gagal membaca PDF: ${error.message}. Pastikan PDF tidak corrupt atau terlindungi password.`;
  }
}

async function extractTextFromPdfFallback(pdfUrl) {
  console.log('Menggunakan fallback extraction untuk:', pdfUrl);
  try {
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    const decoder = new TextDecoder('latin1');
    const text = decoder.decode(arrayBuffer);
    const textMatches = text.match(/BT(.*?)ET/gs);
    let extractedText = '';
    if (textMatches) {
      for (const match of textMatches) {
        const contentMatches = match.match(/\(([^)]+)\)/g);
        if (contentMatches) {
          for (const cm of contentMatches) {
            let cleanText = cm.slice(1, -1);
            cleanText = cleanText.replace(/[^\w\s\.,!?;:()\-=+*/%$#@&<>]/g, ' ');
            if (cleanText.trim().length > 0 && cleanText.length > 3) {
              extractedText += cleanText + '\n';
            }
          }
        }
      }
    }
    if (extractedText.length < 100) {
      const sentences = text.match(/[A-Za-z\s\.,!?;:()\-=+*/%$#@&<>]{20,}/g);
      if (sentences) extractedText = sentences.join('\n');
    }
    return cleanText(extractedText) || 'Tidak dapat membaca teks dari PDF (mungkin PDF berisi gambar/scan). Silakan salin manual.';
  } catch (error) {
    return `Error membaca PDF: ${error.message}`;
  }
}

// ============================================
// HTML EXTRACTION
// ============================================
function extractFromHtml() {
  const contentSelectors = [
    'main', 'article', '.content', '.course-content', '.activity-content',
    '.module-content', '#region-main', '.main-content', '.material-content',
    '.resource-content', '.assignment-content', '.page-content', 'body'
  ];
  let content = '';
  for (const selector of contentSelectors) {
    const element = document.querySelector(selector);
    if (element && element.innerText.trim().length > 50) {
      content = element.innerText;
      break;
    }
  }
  return cleanText(content);
}

// ============================================
// MAIN TASK EXTRACTION
// ============================================
async function extractTaskText() {
  let fullText = '';
  const url = window.location.href;
  const title = document.title || url.split('/').pop();
  fullText += `【Judul】: ${title}\n\n`;
  fullText += `【Sumber】: ${url}\n\n`;
  fullText += `【Konten】:\n`;
  
  if (isPdfPage()) {
    console.log('Mendeteksi halaman PDF');
    if (typeof pdfjsLib !== 'undefined') {
      const pdfText = await extractTextFromPdfWithPdfJs(url);
      if (!pdfText.includes('Gagal') && pdfText.length > 100) {
        fullText += pdfText;
      } else {
        console.log('PDF.js gagal, mencoba fallback...');
        const fallbackText = await extractTextFromPdfFallback(url);
        fullText += fallbackText;
      }
    } else {
      const fallbackText = await extractTextFromPdfFallback(url);
      fullText += fallbackText;
    }
  } else {
    const htmlText = extractFromHtml();
    fullText += htmlText;
  }
  return fullText;
}

async function saveTaskText() {
  if (!isTugasPage() && !isPdfPage()) {
    console.log('Bukan halaman tugas, skip');
    return;
  }
  console.log('Mengekstrak tugas dari:', window.location.href);
  chrome.storage.local.set({ taskLoading: true });
  const taskText = await extractTaskText();
  if (taskText && taskText.length > 30) {
    chrome.storage.local.set({ 
      currentTaskText: taskText,
      taskLoading: false
    });
    console.log('Teks tugas berhasil disimpan, panjang:', taskText.length);
    chrome.runtime.sendMessage({ action: 'taskUpdated', taskText: taskText }).catch(() => {});
  } else {
    console.log('Teks tugas terlalu pendek atau kosong');
    chrome.storage.local.set({ 
      currentTaskText: 'Tidak dapat membaca konten halaman ini. Silakan:\n1. Buka PDF di tab baru\n2. Ctrl+A lalu Ctrl+C\n3. Paste manual ke popup ekstensi',
      taskLoading: false
    });
  }
}

// ============================================
// AUTO-READ FILE FROM LMS
// ============================================
const SUPPORTED_EXTENSIONS = ['.docx', '.xlsx', '.pptx', '.pdf'];

function detectFileLinks() {
  const links = document.querySelectorAll('a[href]');
  const fileLinks = [];
  
  links.forEach(link => {
    const href = link.href.toLowerCase();
    const ext = SUPPORTED_EXTENSIONS.find(ext => href.includes(ext));
    
    if (ext && !link.parentElement.querySelector('.ai-helper-btn')) {
      fileLinks.push({
        url: link.href,
        extension: ext,
        filename: link.textContent.trim() || link.href.split('/').pop(),
        element: link
      });
    }
  });
  
  return fileLinks;
}

function addAIHelperButtons() {
  const fileLinks = detectFileLinks();
  
  fileLinks.forEach(file => {
    const btn = document.createElement('button');
    btn.className = 'ai-helper-btn';
    btn.innerHTML = '🤖 Tanya AI';
    btn.style.cssText = `
      margin-left: 8px;
      padding: 4px 12px;
      background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%);
      color: #1a1a2e;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    `;
    
    btn.addEventListener('mouseenter', () => {
      btn.style.transform = 'translateY(-1px)';
      btn.style.boxShadow = '0 4px 8px rgba(79,172,254,0.3)';
    });
    
    btn.addEventListener('mouseleave', () => {
      btn.style.transform = 'translateY(0)';
      btn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
    });
    
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      
      btn.innerHTML = '⏳ Loading...';
      btn.disabled = true;
      btn.style.opacity = '0.7';
      
      try {
        const extractedText = await fetchAndExtractFile(file.url, file.extension);
        
        const taskText = `【Judul】: ${file.filename}\n\n【Sumber】: ${file.url}\n\n【Konten】:\n${extractedText}`;
        
        chrome.storage.local.set({ 
          currentTaskText: taskText,
          currentFileUrl: file.url 
        });
        
        btn.innerHTML = '✅ Selesai!';
        btn.style.background = '#10b981';
        
        chrome.runtime.sendMessage({ 
          action: 'fileExtracted', 
          filename: file.filename,
          success: true 
        }).catch(() => {});
        
        setTimeout(() => {
          btn.innerHTML = '🤖 Tanya AI';
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.background = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
        }, 3000);
        
      } catch (error) {
        console.error('Error extracting file:', error);
        btn.innerHTML = '❌ Gagal';
        btn.style.background = '#ef4444';
        
        setTimeout(() => {
          alert('Gagal membaca file: ' + error.message + '\n\nCoba download manual lalu upload ke extension.');
          btn.innerHTML = '🤖 Tanya AI';
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.background = 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)';
        }, 500);
      }
    });
    
    file.element.parentNode.insertBefore(btn, file.element.nextSibling);
  });
}

async function fetchAndExtractFile(url, extension) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      'Accept': '*/*'
    }
  });
  
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  
  const blob = await response.blob();
  
  switch(extension) {
    case '.pdf':
      return await extractPdfFromBlob(blob);
    case '.docx':
      return await extractDocxFromBlob(blob);
    case '.xlsx':
      return await extractXlsxFromBlob(blob);
    case '.pptx':
      return await extractPptxFromBlob(blob);
    default:
      throw new Error('Format tidak didukung');
  }
}

async function extractPdfFromBlob(blob) {
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
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function extractDocxFromBlob(blob) {
  if (typeof mammoth === 'undefined') {
    await loadScript('libs/mammoth.browser.min.js');
  }
  
  const arrayBuffer = await blob.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value || 'Tidak ada teks yang diekstrak dari DOCX.';
}

async function extractXlsxFromBlob(blob) {
  if (typeof XLSX === 'undefined') {
    await loadScript('libs/xlsx.full.min.js');
  }
  
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

async function extractPptxFromBlob(blob) {
  if (typeof JSZip === 'undefined') {
    await loadScript('libs/jszip.min.js');
  }
  
  const zip = await JSZip.loadAsync(blob);
  const slideFiles = Object.keys(zip.files).filter(name => 
    name.match(/ppt\/slides\/slide\d+\.xml/)
  );
  
  let fullText = '';
  
  for (const slideFile of slideFiles) {
    const xmlString = await zip.files[slideFile].async('string');
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlString, 'application/xml');
    const textNodes = xmlDoc.getElementsByTagName('a:t');
    let slideText = '';
    
    for (let node of textNodes) {
      slideText += node.textContent + ' ';
    }
    
    if (slideText.trim()) {
      fullText += `\n--- Slide ${slideFile.match(/\d+/)?.[0] || '?'} ---\n${slideText.trim()}\n`;
    }
  }
  
  return fullText.trim() || 'Tidak ada teks dari presentasi.';
}

// ============================================
// INIT
// ============================================
if (isTugasPage() || isPdfPage()) {
  console.log('Halaman tugas/PDF terdeteksi');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { 
      setTimeout(saveTaskText, 1500);
      setTimeout(addAIHelperButtons, 2500);
    });
  } else {
    setTimeout(saveTaskText, 1500);
    setTimeout(addAIHelperButtons, 2500);
  }
}

// Re-run saat ada perubahan DOM (untuk SPA)
const observer = new MutationObserver((mutations) => {
  addAIHelperButtons();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// ============================================
// MESSAGE LISTENER
// ============================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refreshTask') {
    saveTaskText().then(() => sendResponse({ success: true }));
    return true;
  }
  if (request.action === 'detectFiles') {
    const files = detectFileLinks();
    sendResponse({ files: files });
    return true;
  }
  if (request.action === 'extractFile') {
    (async () => {
      try {
        const fileInfo = {
          url: request.url,
          extension: request.extension,
          filename: request.url.split('/').pop()
        };
        
        const extractedText = await fetchAndExtractFile(fileInfo.url, fileInfo.extension);
        
        const taskText = `【Judul】: ${fileInfo.filename}\n\n【Sumber】: ${fileInfo.url}\n\n【Konten】:\n${extractedText}`;
        
        chrome.storage.local.set({ 
          currentTaskText: taskText,
          currentFileUrl: fileInfo.url 
        });
        
        chrome.runtime.sendMessage({ 
          action: 'fileExtracted', 
          filename: fileInfo.filename,
          success: true 
        }).catch(() => {});
        
        sendResponse({ success: true });
      } catch (error) {
        console.error('Extract error:', error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }
});