
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'askAI') {
    handleAskAI(request.taskText, request.taskUrl, request.aiProvider, request.options, request.deepThink, sendResponse);
    return true;
  }
  if (request.action === 'getTaskText') {
    chrome.storage.local.get(['currentTaskText'], (result) => {
      sendResponse({ taskText: result.currentTaskText || '' });
    });
    return true;
  }
});

async function handleAskAI(taskText, taskUrl, aiProvider, selectedOptions, deepThink, sendResponse) {
 
  const isValidUrl = taskUrl && (taskUrl.startsWith('http://') || taskUrl.startsWith('https://'));
  
  if (aiProvider === 'deepseek') {
    if (!isValidUrl && (!taskText || taskText.trim().length === 0)) {
      sendResponse({ success: false, error: 'Tidak ada konten tugas untuk DeepSeek. Upload file atau buka halaman LMS.' });
      return;
    }
  } else if (aiProvider === 'chatgpt') {
    if (!taskText || taskText.trim().length === 0) {
      sendResponse({ success: false, error: 'Tidak ada konten tugas untuk ChatGPT. Upload file atau refresh halaman LMS.' });
      return;
    }
  } else {
    sendResponse({ success: false, error: 'AI provider tidak dikenal.' });
    return;
  }

 
  let finalText = taskText;
  if (aiProvider === 'chatgpt' && finalText.length > 20000) {
    finalText = finalText.substring(0, 20000) + '\n\n[Konten dipotong karena terlalu panjang]';
  }

 
  let promptText = buildPrompt(finalText, taskUrl, selectedOptions, deepThink, aiProvider, isValidUrl);
  
  console.log(`Sending to ${aiProvider}, prompt length: ${promptText.length}`);
  
  let aiUrl = '';
  if (aiProvider === 'deepseek') {
    aiUrl = 'https://chat.deepseek.com/';
  } else if (aiProvider === 'chatgpt') {
    aiUrl = 'https://chat.openai.com/';
  }
  
  const tab = await chrome.tabs.create({ url: aiUrl });
  
  const listener = (tabId, changeInfo) => {
    if (tabId === tab.id && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      const delay = aiProvider === 'chatgpt' ? 5000 : 2000;
      setTimeout(() => {
        injectPromptToAI(tab.id, promptText, aiProvider).catch(console.error);
      }, delay);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  
  sendResponse({ success: true });
}

function buildPrompt(taskContent, taskUrl, selectedOptions, deepThink, aiProvider, useUrl = false) {
  let systemPrompt = `Anda adalah asisten AI yang membantu mahasiswa memahami materi dan tugas kuliah.`;
  
  if (deepThink && aiProvider === 'deepseek') {
    systemPrompt += ` Gunakan metode berpikir mendalam (deep reasoning) dan analitis. Jabarkan langkah demi langkah dengan detail.`;
  }
  
  let userRequest = '';
  if (aiProvider === 'deepseek' && useUrl) {
    
    userRequest = `Tolong bantu saya memahami materi dan tugas kuliah berikut:\n${taskUrl}\n\n`;
  } else {
    
    let contentSource = (taskUrl && !useUrl) ? `File: ${taskUrl}` : 'Konten tugas';
    userRequest = `Tolong bantu saya memahami materi dan tugas kuliah berikut (${contentSource}):\n\n--- ISI TUGAS ---\n${taskContent}\n--- AKHIR ISI TUGAS ---\n\n`;
  }
  
  userRequest += `Saya ingin Anda menjelaskan hal-hal berikut:\n`;
  
  const optionMap = {
    'ringkasan': 'Ringkasan materi',
    'penjelasan': 'Penjelasan tugas',
    'langkah': 'Langkah-langkah pengerjaan step by step',
    'tips': 'Tips tambahan'
  };
  
  if (selectedOptions && selectedOptions.length > 0) {
    for (let opt of selectedOptions) {
      if (optionMap[opt]) userRequest += `- ${optionMap[opt]}\n`;
    }
  } else {
    userRequest += `- Ringkasan materi\n- Penjelasan tugas\n- Langkah-langkah pengerjaan\n- Tips tambahan\n`;
  }
  
  userRequest += `\nJelaskan dengan cara yang mudah dipahami dan berikan panduan sesuai poin di atas.`;
  
  return `${systemPrompt}\n\n${userRequest}`;
}

async function injectPromptToAI(tabId, promptText, aiProvider) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (text, provider) => {
        const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
        
        if (provider === 'chatgpt') {
          (async () => {
            const findInput = () => {
              const selectors = [
                'textarea#prompt-textarea',
                'textarea[data-id="root"]',
                'textarea[placeholder*="Message"]',
                'textarea[placeholder*="Pesan"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'form textarea',
                'textarea'
              ];
              for (let sel of selectors) {
                const el = document.querySelector(sel);
                if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable)) return el;
              }
              return null;
            };
            
            const findSendButton = () => {
              let btn = document.querySelector('button[data-testid="send-button"]');
              if (!btn) btn = document.querySelector('button[aria-label="Send message"]');
              if (!btn) btn = document.querySelector('button[aria-label="Kirim pesan"]');
              if (!btn) btn = document.querySelector('button[type="submit"]');
              if (!btn) {
                const btns = document.querySelectorAll('button');
                for (let b of btns) {
                  if (!b.disabled && b.querySelector('svg')) { btn = b; break; }
                }
              }
              return btn;
            };
            
            let input = null;
            for (let i = 0; i < 20; i++) {
              input = findInput();
              if (input) break;
              await delay(500);
            }
            
            if (!input) {
              alert('Tidak dapat menemukan kolom input ChatGPT. Pastikan Anda sudah login.\n\nSalin manual:\n' + text.slice(0, 500));
              return;
            }
            
            input.focus();
            if (input.tagName === 'TEXTAREA') {
              input.value = text;
            } else {
              input.innerText = text;
            }
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (input.isContentEditable) {
              input.dispatchEvent(new InputEvent('input', { bubbles: true }));
            }
            
            await delay(800);
            let sendBtn = findSendButton();
            let attempts = 0;
            while ((!sendBtn || sendBtn.disabled) && attempts < 10) {
              await delay(300);
              sendBtn = findSendButton();
              attempts++;
            }
            
            if (sendBtn && !sendBtn.disabled) {
              sendBtn.click();
            } else {
              input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
            }
          })();
        } 
        else if (provider === 'deepseek') {
          (async () => {
            const findInput = () => {
              const selectors = [
                'textarea', 'div[contenteditable="true"]', '[contenteditable="true"]',
                '.chat-input', 'textarea[placeholder*="Ask"]', 'div[role="textbox"]'
              ];
              for (let sel of selectors) {
                const el = document.querySelector(sel);
                if (el) return el;
              }
              return null;
            };
            
            const setValue = (el, val) => {
              if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
              } else if (el.isContentEditable) {
                el.innerText = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new InputEvent('input', { bubbles: true }));
              }
            };
            
            const clickSend = () => {
              const sendSelectors = [
                'button[type="submit"]', 'button[aria-label="Send"]', '.send-button'
              ];
              for (let sel of sendSelectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled) {
                  btn.click();
                  return true;
                }
              }
              const input = findInput();
              if (input) {
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
                return true;
              }
              return false;
            };
            
            let input = null;
            for (let i = 0; i < 20; i++) {
              input = findInput();
              if (input) break;
              await delay(500);
            }
            
            if (input) {
              setValue(input, text);
              await delay(500);
              clickSend();
            } else {
              alert('Kolom DeepSeek tidak terdeteksi. Salin manual:\n' + text.slice(0, 500));
            }
          })();
        }
      },
      args: [promptText, aiProvider]
    });
  } catch (error) {
    console.error('Inject error:', error);
  }
}