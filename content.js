
console.log('DeepSeek LMS Helper: Content script loaded');


if (typeof pdfjsLib !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('libs/pdf.worker.js');
  console.log('PDF.js loaded successfully');
}


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


if (isTugasPage() || isPdfPage()) {
  console.log('Halaman tugas/PDF terdeteksi');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { setTimeout(saveTaskText, 1500); });
  } else {
    setTimeout(saveTaskText, 1500);
  }
}


chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'refreshTask') {
    saveTaskText().then(() => sendResponse({ success: true }));
    return true;
  }
});