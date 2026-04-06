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
 
  let isValidUrl = taskUrl && (taskUrl.startsWith('http://') || taskUrl.startsWith('https://'));
  
  // Gemini selalu butuh text content, tidak support URL fetch
  if (aiProvider === 'gemini') {
    if (!taskText || taskText.trim().length === 0) {
      sendResponse({ success: false, error: 'Tidak ada konten tugas untuk Gemini. Extract file terlebih dahulu.' });
      return;
    }
    // Force useUrl = false untuk Gemini
    isValidUrl = false;
  } else if (aiProvider === 'deepseek' || aiProvider === 'kimi') {
    if (!isValidUrl && (!taskText || taskText.trim().length === 0)) {
      sendResponse({ success: false, error: 'Tidak ada konten tugas untuk ' + aiProvider + '. Upload file atau buka halaman LMS.' });
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
  // Gemini bisa handle text lebih panjang
  if ((aiProvider === 'chatgpt' || aiProvider === 'kimi') && finalText.length > 20000) {
    finalText = finalText.substring(0, 20000) + '\n\n[Konten dipotong karena terlalu panjang]';
  } else if (aiProvider === 'gemini' && finalText.length > 30000) {
    finalText = finalText.substring(0, 30000) + '\n\n[Konten dipotong karena terlalu panjang untuk Gemini]';
  }

 
  let promptText = buildPrompt(finalText, taskUrl, selectedOptions, deepThink, aiProvider, isValidUrl);
  
  console.log(`Sending to ${aiProvider}, prompt length: ${promptText.length}`);
  
  let aiUrl = '';
  if (aiProvider === 'deepseek') {
    aiUrl = 'https://chat.deepseek.com/';
  } else if (aiProvider === 'chatgpt') {
    aiUrl = 'https://chat.openai.com/';
  } else if (aiProvider === 'kimi') {
    aiUrl = 'https://www.kimi.com/';
  } else if (aiProvider === 'gemini') {
    aiUrl = 'https://gemini.google.com/';
  }
  
  const tab = await chrome.tabs.create({ url: aiUrl });
  
  const listener = (tabId, changeInfo) => {
    if (tabId === tab.id && changeInfo.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      const delay = aiProvider === 'chatgpt' ? 5000 : 
                   (aiProvider === 'kimi' ? 6000 : 
                   (aiProvider === 'gemini' ? 6000 : 2000));
      setTimeout(() => {
        injectPromptToAI(tab.id, promptText, aiProvider).catch(console.error);
      }, delay);
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
  
  sendResponse({ success: true });
}

function buildPrompt(taskContent, taskUrl, selectedOptions, deepThink, aiProvider, useUrl = false) {
  // Untuk Gemini, SELALU kirim konten text (tidak support URL fetch)
  if (aiProvider === 'gemini') {
    let prompt = `Anda adalah asisten AI yang membantu mahasiswa memahami materi dan tugas kuliah.\n\n`;
    
    // Ambil konten dari taskContent (sudah berisi text hasil extract)
    const contentMatch = taskContent.match(/【Konten】:\n([\s\S]*)/);
    const actualContent = contentMatch ? contentMatch[1].trim() : taskContent;
    
    // Batasi panjang untuk Gemini (max ~30k chars untuk safety)
    let trimmedContent = actualContent;
    if (trimmedContent.length > 25000) {
      trimmedContent = trimmedContent.substring(0, 25000) + 
        '\n\n[... Konten dipotong karena terlalu panjang, silakan fokus pada bagian utama ...]';
    }
    
    prompt += `Tolong bantu saya memahami materi dan tugas kuliah berikut:\n\n`;
    prompt += `--- ISI MATERI/TUGAS ---\n`;
    prompt += trimmedContent;
    prompt += `\n--- AKHIR ISI ---\n\n`;
    
    prompt += `Saya ingin Anda menjelaskan:\n`;
    
    const optionMap = {
      'ringkasan': '- Ringkasan materi',
      'penjelasan': '- Penjelasan tugas',
      'langkah': '- Langkah-langkah pengerjaan step by step',
      'tips': '- Tips tambahan'
    };
    
    if (selectedOptions && selectedOptions.length > 0) {
      for (let opt of selectedOptions) {
        if (optionMap[opt]) prompt += `${optionMap[opt]}\n`;
      }
    } else {
      prompt += `- Ringkasan materi\n- Penjelasan tugas\n- Langkah-langkah pengerjaan\n- Tips tambahan\n`;
    }
    
    prompt += `\nJelaskan dengan cara yang mudah dipahami dan berikan panduan sesuai poin di atas.`;
    
    return prompt;
  }
  
  // Simplify prompt untuk Kimi (support URL)
  if (aiProvider === 'kimi' && useUrl) {
    let prompt = `Bantu jelaskan materi dan tugas kuliah dari: ${taskUrl}\n\n`;
    prompt += `Jelaskan: `;
    
    const options = [];
    if (selectedOptions.includes('ringkasan')) options.push('ringkasan materi');
    if (selectedOptions.includes('penjelasan')) options.push('penjelasan tugas');
    if (selectedOptions.includes('langkah')) options.push('langkah pengerjaan');
    if (selectedOptions.includes('tips')) options.push('tips tambahan');
    
    prompt += options.join(', ') || 'semua poin di atas';
    prompt += `. Jelaskan dengan mudah dipahami.`;
    
    return prompt;
  }
  
  // Format normal untuk DeepSeek dan ChatGPT
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
        else if (provider === 'kimi') {
          (async () => {
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
            await delay(5000);
            
            const copyToClipboard = async (str) => {
              try {
                await navigator.clipboard.writeText(str);
                return true;
              } catch (err) {
                const textarea = document.createElement('textarea');
                textarea.value = str;
                textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
                document.body.appendChild(textarea);
                textarea.select();
                const result = document.execCommand('copy');
                document.body.removeChild(textarea);
                return result;
              }
            };
            
            await copyToClipboard(text);
            
            const findSlateEditor = () => {
              const selectors = [
                'div[data-slate-editor="true"]',
                'div[data-slate-node="element"]',
                '[data-slate-editor]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]'
              ];
              
              for (let sel of selectors) {
                const el = document.querySelector(sel);
                if (el && el.isContentEditable) {
                  return el;
                }
              }
              return null;
            };
            
            const clearEditor = (editor) => {
              editor.focus();
              editor.click();
              const selection = window.getSelection();
              const range = document.createRange();
              range.selectNodeContents(editor);
              selection.removeAllRanges();
              selection.addRange(range);
              document.execCommand('delete');
              editor.blur();
              editor.focus();
            };
            
            const pasteWithFocus = async (editor, str) => {
              await copyToClipboard(str);
              await delay(200);
              clearEditor(editor);
              await delay(300);
              const success = document.execCommand('paste');
              await delay(500);
              
              const result = editor.innerText || editor.textContent || '';
              
              if (result.length < str.length * 0.5) {
                clearEditor(editor);
                await delay(200);
                document.execCommand('insertText', false, str);
                await delay(300);
              }
            };
            
            const clickSend = async () => {
              const sendSelectors = [
                'button[class*="send"]',
                'button[type="submit"]',
                'button[aria-label*="Send"]',
                'button[data-testid*="send"]',
                'button:has(> svg)'
              ];
              
              for (let sel of sendSelectors) {
                const btn = document.querySelector(sel);
                if (btn && !btn.disabled && btn.offsetParent !== null) {
                  btn.click();
                  await delay(200);
                  return true;
                }
              }
              
              const buttons = document.querySelectorAll('button');
              for (let btn of buttons) {
                if (!btn.disabled && btn.querySelector('svg')) {
                  const rect = btn.getBoundingClientRect();
                  if (rect.width > 30 && rect.height > 30) {
                    btn.click();
                    await delay(200);
                    return true;
                  }
                }
              }
              
              return false;
            };
            
            let editor = null;
            
            for (let attempt = 0; attempt < 20; attempt++) {
              editor = findSlateEditor();
              if (editor) break;
              await delay(600);
            }
            
            if (!editor) {
              const modalId = 'kimi-manual-' + Date.now();
              const div = document.createElement('div');
              div.innerHTML = `
                <div id="${modalId}" style="
                  position:fixed;top:0;left:0;right:0;bottom:0;
                  background:rgba(0,0,0,0.9);z-index:2147483647;
                  display:flex;align-items:center;justify-content:center;
                ">
                  <div style="
                    background:#1a1a2e;padding:24px;border-radius:16px;
                    max-width:500px;width:90%;color:#e0e0e0;
                    border:1px solid #4facfe;
                  ">
                    <h3 style="color:#4facfe;margin:0 0 16px 0;">🤖 Kimi AI - Manual Paste</h3>
                    <p style="font-size:13px;margin-bottom:12px;">
                      Prompt telah di-copy. Klik kolom chat Kimi lalu paste (Ctrl+V):
                    </p>
                    <textarea style="
                      width:100%;height:150px;background:rgba(0,0,0,0.4);
                      color:#e0e0e0;border:1px solid #4facfe;border-radius:8px;
                      padding:12px;font-size:11px;font-family:monospace;resize:none;
                      margin-bottom:16px;
                    " readonly>${text.replace(/</g, '&lt;')}</textarea>
                    <button onclick="this.closest('#${modalId}').remove()" style="
                      width:100%;padding:12px;background:#4facfe;color:#1a1a2e;
                      border:none;border-radius:8px;cursor:pointer;font-weight:600;
                    ">✓ Tutup</button>
                  </div>
                </div>
              `;
              document.body.appendChild(div);
              return;
            }
            
            await pasteWithFocus(editor, text);
            
            let editorText = editor.innerText || editor.textContent || '';
            
            if (editorText.length < text.length * 0.8) {
              const chunkSize = 100;
              const chunks = [];
              for (let i = 0; i < text.length; i += chunkSize) {
                chunks.push(text.slice(i, i + chunkSize));
              }
              
              clearEditor(editor);
              await delay(300);
              
              for (let i = 0; i < chunks.length; i++) {
                const chunk = chunks[i];
                document.execCommand('insertText', false, chunk);
                editor.dispatchEvent(new InputEvent('input', {
                  bubbles: true,
                  inputType: 'insertText',
                  data: chunk
                }));
                await delay(100);
              }
            }
            
            await delay(800);
            
            const sent = await clickSend();
            
            if (!sent) {
              editor.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Enter', code: 'Enter', keyCode: 13, 
                bubbles: true, cancelable: true, composed: true 
              }));
            }
          })();
        }
        else if (provider === 'gemini') {
          (async () => {
            const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
            await delay(6000);
            
            const copyToClipboard = async (str) => {
              try {
                await navigator.clipboard.writeText(str);
                return true;
              } catch (err) {
                const textarea = document.createElement('textarea');
                textarea.value = str;
                textarea.style.cssText = 'position:fixed;left:-9999px;opacity:0;';
                document.body.appendChild(textarea);
                textarea.select();
                const result = document.execCommand('copy');
                document.body.removeChild(textarea);
                return result;
              }
            };
            
            await copyToClipboard(text);
            
            // Gemini menggunakan textarea dengan placeholder "Enter a prompt here"
            const findInput = () => {
              const selectors = [
                'textarea[placeholder*="prompt"]',
                'textarea[placeholder*="Prompt"]',
                'textarea[placeholder*="Enter"]',
                'textarea[placeholder*="Tanyakan"]',
                'textarea[placeholder*="Ketik"]',
                'div[contenteditable="true"][role="textbox"]',
                'div[contenteditable="true"]',
                'textarea',
                'rich-textarea',
                '[data-testid="input-text"]'
              ];
              
              for (let sel of selectors) {
                const el = document.querySelector(sel);
                if (el && (el.tagName === 'TEXTAREA' || el.isContentEditable)) {
                  console.log('Found Gemini input:', sel, el);
                  return el;
                }
              }
              return null;
            };
            
            const clearAndPaste = async (input) => {
              input.focus();
              input.click();
              
              // Select all
              input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'a', code: 'KeyA', ctrlKey: true, bubbles: true 
              }));
              await delay(100);
              
              // Delete
              input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'Delete', code: 'Delete', bubbles: true 
              }));
              await delay(100);
              
              // Paste
              input.dispatchEvent(new KeyboardEvent('keydown', { 
                key: 'v', code: 'KeyV', ctrlKey: true, bubbles: true 
              }));
              await delay(500);
              
              // Cek hasil
              const currentValue = input.value || input.innerText || input.textContent || '';
              console.log('After paste:', currentValue.length, 'chars');
              
              // Jika gagal, coba set value langsung
              if (currentValue.length < text.length * 0.3) {
                console.log('Paste failed, trying direct set...');
                if (input.tagName === 'TEXTAREA') {
                  input.value = text;
                } else {
                  input.innerText = text;
                }
                
                // Trigger events
                ['focus', 'input', 'change', 'keyup'].forEach(eventType => {
                  const event = eventType === 'input' || eventType === 'change' 
                    ? new Event(eventType, { bubbles: true })
                    : new KeyboardEvent(eventType, { bubbles: true });
                  input.dispatchEvent(event);
                });
              }
            };
            
            const clickSend = async () => {
              const sendSelectors = [
                'button[aria-label*="Send"]',
                'button[aria-label*="Kirim"]',
                'button[data-testid*="send"]',
                'button[class*="send"]',
                'button[type="submit"]',
                'button:has(> svg)',
                'button:has(> [data-testid="send-icon"])',
                'button'
              ];
              
              for (let sel of sendSelectors) {
                const btns = sel === 'button' 
                  ? document.querySelectorAll('button')
                  : document.querySelectorAll(sel);
                  
                for (let btn of btns) {
                  if (btn.disabled || btn.offsetParent === null) continue;
                  
                  const text = btn.textContent.toLowerCase();
                  const hasSendIcon = btn.querySelector('svg, [data-testid*="send"], [class*="send"]');
                  
                  if (hasSendIcon || text.includes('send') || text.includes('submit')) {
                    console.log('Clicking Gemini send:', sel);
                    btn.click();
                    await delay(300);
                    return true;
                  }
                }
              }
              
              return false;
            };
            
            let input = null;
            
            for (let attempt = 0; attempt < 25; attempt++) {
              input = findInput();
              if (input) break;
              await delay(600);
            }
            
            if (!input) {
              console.error('Gemini input not found');
              
              const modalId = 'gemini-manual-' + Date.now();
              const div = document.createElement('div');
              div.innerHTML = `
                <div id="${modalId}" style="
                  position:fixed;top:0;left:0;right:0;bottom:0;
                  background:rgba(0,0,0,0.9);z-index:2147483647;
                  display:flex;align-items:center;justify-content:center;
                ">
                  <div style="
                    background:linear-gradient(135deg, #4285f4 0%, #34a853 50%, #fbbc04 100%);
                    padding:24px;border-radius:16px;
                    max-width:500px;width:90%;color:#1a1a2e;
                    box-shadow:0 20px 60px rgba(0,0,0,0.5);
                  ">
                    <h3 style="margin:0 0 16px 0;color:#fff;font-size:20px;">♊ Gemini - Manual Paste</h3>
                    <p style="font-size:13px;margin-bottom:12px;color:#fff;">
                      Kolom input tidak terdeteksi. Prompt telah di-copy. Silakan:
                    </p>
                    <ol style="font-size:12px;margin:0 0 16px 20px;padding:0;color:#fff;line-height:1.8;">
                      <li>Klik kolom chat Gemini</li>
                      <li>Tekan <strong>Ctrl+V</strong> untuk paste</li>
                      <li>Tekan <strong>Enter</strong> untuk kirim</li>
                    </ol>
                    <textarea style="
                      width:100%;height:150px;background:rgba(255,255,255,0.95);
                      color:#1a1a2e;border:none;border-radius:8px;
                      padding:12px;font-size:11px;font-family:monospace;resize:none;
                      margin-bottom:16px;
                    " readonly>${text.replace(/</g, '&lt;')}</textarea>
                    <div style="display:flex;gap:12px;">
                      <button id="${modalId}-copy" style="
                        flex:1;padding:12px;background:#fff;color:#4285f4;
                        border:none;border-radius:8px;cursor:pointer;font-weight:600;
                      ">📋 Copy & Tutup</button>
                      <button id="${modalId}-close" style="
                        flex:1;padding:12px;background:rgba(255,255,255,0.3);color:#fff;
                        border:1px solid #fff;border-radius:8px;cursor:pointer;font-weight:600;
                      ">✕ Tutup</button>
                    </div>
                  </div>
                </div>
              `;
              document.body.appendChild(div);
              
              document.getElementById(`${modalId}-copy`).onclick = () => {
                const textarea = div.querySelector('textarea');
                textarea.select();
                document.execCommand('copy');
                if (navigator.clipboard) {
                  navigator.clipboard.writeText(text).catch(() => {});
                }
                div.remove();
              };
              
              document.getElementById(`${modalId}-close`).onclick = () => {
                div.remove();
              };
              
              return;
            }
            
            console.log('Gemini input found, inserting text...');
            await clearAndPaste(input);
            
            await delay(1000);
            
            const sent = await clickSend();
            
            if (!sent) {
              console.log('Send not found, trying Enter...');
              
              for (let i = 0; i < 3; i++) {
                input.dispatchEvent(new KeyboardEvent('keydown', { 
                  key: 'Enter', code: 'Enter', keyCode: 13, 
                  bubbles: true, cancelable: true 
                }));
                await delay(200);
              }
            }
            
            console.log('Gemini injection completed');
          })();
        }
      },
      args: [promptText, aiProvider]
    });
  } catch (error) {
    console.error('Inject error:', error);
  }
}