// ================== НАСТРОЙКИ ==================
const API_URL = 'https://script.google.com/macros/s/AKfycbwwdvYnW5fHkmr_iY8yR2j5z_R1BaZFdgYbOtEoUKf7WdzatAHgpRqzlPImnas6R2Ua_g/exec'; // ← ЗАМЕНИТЕ
// ================================================


const localDB = new PouchDB('warehouse_local');
let currentUser = localStorage.getItem('warehouse_user') || '';
let scannedItemsBuffer = [];
let isOnline = navigator.onLine;

window.addEventListener('online', () => { isOnline = true; setStatus('🔄 Онлайн', 'status-online'); syncFromCloud(); });
window.addEventListener('offline', () => { isOnline = false; setStatus('📴 Офлайн', 'status-offline'); });

function setStatus(text, className) {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.innerHTML = text;
    el.className = className;
}

document.addEventListener('DOMContentLoaded', async () => {
    if (!currentUser) {
        currentUser = prompt('Введите ваше имя:') || 'Гость';
        localStorage.setItem('warehouse_user', currentUser);
    }
    
    setStatus('🔄 Загрузка...', 'status-syncing');
    if (isOnline) await syncFromCloud();
    
    openTab('stock', null);
    renderAll();
    
    setInterval(() => { if (isOnline) syncFromCloud(); }, 30000);
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
    
    const cameraInput = document.getElementById('cameraInput');
    if (cameraInput) cameraInput.addEventListener('change', handleCameraFile);
});

function renderAll() {
    renderStockList();
    renderTakeList();
    renderJournal();
}

// ================== СИНХРОНИЗАЦИЯ ==================
async function syncFromCloud() {
    if (!isOnline) return;
    setStatus('🔄 Загрузка...', 'status-syncing');
    
    try {
        const itemsRes = await fetch(`${API_URL}?action=getItems`);
        const itemsData = await itemsRes.json();
        
        if (itemsData.items) {
            for (const item of itemsData.items) {
                if (!item.ID) continue;
                const doc = {
                    _id: item.ID,
                    type: 'item',
                    name: item['Наименование'] || '',
                    category: item['Категория'] || '',
                    qty: parseFloat(item['Остаток']) || 0,
                    unit: item['ЕдиницаИзмерения'] || 'шт',
                    photoUrl: item['ФотоURL'] || '',
                    photoBase64: item['ФотоBase64'] || ''
                };
                try {
                    const existing = await localDB.get(doc._id);
                    doc._rev = existing._rev;
                } catch (e) {}
                await localDB.put(doc);
            }
        }
        
        const journalRes = await fetch(`${API_URL}?action=getJournal`);
        const journalData = await journalRes.json();
        if (journalData.journal) {
            localStorage.setItem('cloud_journal', JSON.stringify(journalData.journal));
        }
        
        setStatus('✅ Готово', 'status-online');
        renderAll();
    } catch (err) {
        setStatus('❌ Ошибка: ' + err.message, 'status-error');
    }
}

async function saveToCloud(params) {
    if (!isOnline) {
        alert('Нет интернета. Данные сохранятся локально.');
        return false;
    }
    
    const queryString = Object.keys(params)
        .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
        .join('&');
    
    try {
        const res = await fetch(`${API_URL}?${queryString}`);
        const data = await res.json();
        if (data.error) {
            alert('Ошибка сервера: ' + data.error);
            return false;
        }
        return true;
    } catch (err) {
        alert('Ошибка отправки: ' + err.message);
        return false;
    }
}

// ================== ИНТЕРФЕЙС ==================
function openTab(tabId, evt) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.add('active');
    if (evt && evt.target) evt.target.classList.add('active');
    
    if (tabId === 'stock') renderStockList();
    if (tabId === 'take') renderTakeList();
    if (tabId === 'journal') renderJournal();
}

async function renderStockList() {
    const container = document.getElementById('stockList');
    if (!container) return;
    
    const result = await localDB.allDocs({ include_docs: true });
    const items = result.rows.filter(r => r.doc.type === 'item');
    
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">📭 Склад пуст<br><small>Добавьте товары во вкладке «Приход»</small></div>';
        return;
    }
    
    let html = '<h3>📦 Остатки на складе</h3>';
    for (const item of items) {
        const doc = item.doc;
        let photoHtml = '';
        if (doc.photoBase64) {
            photoHtml = `<br><img src="${doc.photoBase64}" class="photo-thumb">`;
        } else if (doc.photoUrl) {
            photoHtml = `<br><img src="${doc.photoUrl}" class="photo-thumb" onerror="this.style.display='none'">`;
        }
        
        const cat = doc.category ? `<span style="background:#e0e0e0; padding:2px 8px; border-radius:10px; font-size:12px;">${doc.category}</span>` : '';
        
        html += `
        <div class="card">
            <div style="flex:1;">
                <strong>${doc.name}</strong> ${cat}
                <span style="color:#666;"> — ${doc.qty} ${doc.unit}</span>
                ${photoHtml}
                <div class="btn-group">
                    <button onclick="takePhotoForItem('${doc._id}')">📸 Своё фото</button>
                    <button onclick="searchPhotoForItem('${doc._id}', '${doc.name.replace(/'/g, "\\'")}')">🔍 Из интернета</button>
                </div>
            </div>
            <button class="danger" onclick="deleteItem('${doc._id}')" style="margin-left:10px;">🗑️</button>
        </div>`;
    }
    container.innerHTML = html;
}

async function deleteItem(docId) {
    if (!confirm('Удалить этот товар? Данные будут удалены из таблицы безвозвратно.')) return;
    
    try {
        const doc = await localDB.get(docId);
        const itemName = doc.name || 'Неизвестный товар';
        
        // Удаляем из локальной базы
        await localDB.remove(doc);
        
        // Отправляем команду удаления
        const success = await saveToCloud({
            action: 'deleteItem',
            id: docId,
            user: currentUser,
            name: itemName
        });
        
        if (success) {
            alert('✅ Товар удалён из таблицы');
        } else {
            alert('⚠️ Удалён локально, но не из таблицы. Проверьте интернет.');
        }
        
        renderAll();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

async function renderTakeList() {
    const container = document.getElementById('takeList');
    if (!container) return;
    
    const search = (document.getElementById('searchItem')?.value || '').toLowerCase();
    const result = await localDB.allDocs({ include_docs: true });
    const items = result.rows.filter(r => 
        r.doc.type === 'item' && 
        r.doc.name.toLowerCase().includes(search)
    );
    
    if (items.length === 0) {
        container.innerHTML = '<div class="empty-state">🔍 Ничего не найдено</div>';
        return;
    }
    
    let html = '';
    for (const item of items) {
        const doc = item.doc;
        let photoHtml = '';
        if (doc.photoBase64) {
            photoHtml = `<img src="${doc.photoBase64}" class="photo-thumb">`;
        } else if (doc.photoUrl) {
            photoHtml = `<img src="${doc.photoUrl}" class="photo-thumb" onerror="this.style.display='none'">`;
        }
        
        html += `
        <div class="card">
            <div style="flex:1;">
                <div style="display:flex; align-items:center; gap:10px;">
                    ${photoHtml}
                    <div>
                        <strong>${doc.name}</strong>
                        <div style="color:#666;">Остаток: ${doc.qty} ${doc.unit}</div>
                    </div>
                </div>
                <div style="display:flex; gap:5px; margin-top:8px;">
                    <input type="number" id="tq_${doc._id}" placeholder="Сколько" min="1" max="${doc.qty}" style="flex:1;">
                    <input type="text" id="tw_${doc._id}" placeholder="Куда" style="flex:2;">
                </div>
                <button onclick="takeItem('${doc._id}', '${doc.name.replace(/'/g, "\\'")}')" style="width:100%; margin-top:5px;">✅ Забрать</button>
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

async function takeItem(docId, name) {
    const qtyInput = document.getElementById(`tq_${docId}`);
    const destInput = document.getElementById(`tw_${docId}`);
    const qty = parseInt(qtyInput?.value);
    const dest = destInput?.value || 'Не указано';
    
    if (!qty || qty <= 0) return alert('Укажите количество');
    
    try {
        const doc = await localDB.get(docId);
        if (doc.qty < qty) return alert('Недостаточно на складе!');
        
        doc.qty -= qty;
        await localDB.put(doc);
        
        await localDB.put({
            _id: 'j_' + Date.now(),
            type: 'journal',
            time: new Date().toISOString(),
            user: currentUser,
            operation: 'Расход',
            itemId: docId,
            itemName: name,
            qty: qty,
            destination: dest
        });
        
        await saveToCloud({
            action: 'takeItem',
            id: docId,
            qty: qty,
            destination: dest,
            user: currentUser,
            name: name
        });
        
        alert('✅ Списано!');
        renderAll();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

async function addItem() {
    const name = document.getElementById('newName')?.value?.trim();
    const qty = parseInt(document.getElementById('newQty')?.value);
    const unit = document.getElementById('newUnit')?.value || 'шт';
    const category = document.getElementById('newCategory')?.value || '';
    
    if (!name) return alert('Введите название');
    if (!qty || qty <= 0) return alert('Введите количество');
    
    const id = 'item_' + Date.now();
    
    await localDB.put({ _id: id, type: 'item', name, category, qty, unit, photoUrl: '', photoBase64: '' });
    await localDB.put({
        _id: 'j_' + Date.now(),
        type: 'journal',
        time: new Date().toISOString(),
        user: currentUser,
        operation: 'Приход',
        itemId: id,
        itemName: name,
        qty: qty,
        destination: 'Склад'
    });
    
    await saveToCloud({
        action: 'addItem',
        id: id,
        name: name,
        qty: qty,
        unit: unit,
        category: category,
        user: currentUser
    });
    
    document.getElementById('newName').value = '';
    document.getElementById('newQty').value = '';
    
    alert('✅ Добавлено!');
    renderAll();
}

async function renderJournal() {
    const container = document.getElementById('journalList');
    if (!container) return;
    
    const result = await localDB.allDocs({ include_docs: true });
    const localJournal = result.rows
        .filter(r => r.doc.type === 'journal')
        .sort((a, b) => new Date(b.doc.time) - new Date(a.doc.time));
    
    const cloudJournal = JSON.parse(localStorage.getItem('cloud_journal') || '[]');
    
    if (localJournal.length === 0 && cloudJournal.length === 0) {
        container.innerHTML = '<div class="empty-state">📋 Журнал пуст</div>';
        return;
    }
    
    let html = '<h3>📋 Последние операции</h3>';
    
    for (const entry of localJournal.slice(0, 20)) {
        const doc = entry.doc;
        const emoji = doc.operation === 'Расход' ? '🔴' : doc.operation === 'Удаление' ? '⛔' : '🟢';
        html += `
        <div class="card">
            <div>
                ${emoji} <strong>${doc.itemName}</strong> ×${doc.qty}
                <div style="font-size:12px; color:#666;">
                    → ${doc.destination} | ${new Date(doc.time).toLocaleString('ru-RU')} | ${doc.user}
                </div>
            </div>
        </div>`;
    }
    
    if (localJournal.length === 0 && cloudJournal.length > 0) {
        for (const entry of cloudJournal.slice(-20).reverse()) {
            const emoji = entry['ТипОперации'] === 'Расход' ? '🔴' : entry['ТипОперации'] === 'Удаление' ? '⛔' : '🟢';
            html += `
            <div class="card">
                <div>
                    ${emoji} ${entry['Комментарий'] || 'Товар'} ×${entry['Количество']}
                    <div style="font-size:12px; color:#666;">
                        ${entry['Время']} | ${entry['Сотрудник']}
                    </div>
                </div>
            </div>`;
        }
    }
    
    container.innerHTML = html;
}

// ================== ФОТО ==================
function takePhotoForItem(itemId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64 = ev.target.result;
            
            try {
                const doc = await localDB.get(itemId);
                doc.photoBase64 = base64;
                await localDB.put(doc);
                
                try {
                    await saveToCloud({
                        action: 'updatePhoto',
                        id: itemId,
                        photoBase64: base64.substring(0, 50000)
                    });
                } catch (e) {}
                
                alert('✅ Фото сохранено!');
                renderAll();
            } catch (err) {
                alert('Ошибка: ' + err.message);
            }
        };
        reader.readAsDataURL(file);
    };
    
    input.click();
}

async function searchPhotoForItem(itemId, itemName) {
    window.open(`https://www.google.com/search?tbm=isch&q=${encodeURIComponent(itemName)}`, '_blank');
    
    const url = prompt('Вставьте прямую ссылку на фото (URL):');
    if (!url) return;
    
    try {
        const doc = await localDB.get(itemId);
        doc.photoUrl = url;
        await localDB.put(doc);
        
        await saveToCloud({
            action: 'updatePhoto',
            id: itemId,
            photoUrl: url
        });
        
        alert('✅ Фото из интернета сохранено!');
        renderAll();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

// ================== СКАНЕР ==================
async function handleCameraFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusDiv = document.getElementById('scanResult');
    if (!statusDiv) return;
    
    statusDiv.style.display = 'block';
    statusDiv.innerHTML = '⏳ Идёт распознавание текста...';
    
    try {
        const worker = await Tesseract.createWorker('rus');
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        
        const lines = text.split('\n').filter(l => l.trim());
        scannedItemsBuffer = lines.map(line => {
            const parts = line.trim().split(' ');
            const qty = parseFloat(parts[parts.length - 1]);
            const name = isNaN(qty) ? line.trim() : parts.slice(0, -1).join(' ');
            return { name: name || 'Неизвестно', qty: isNaN(qty) ? 1 : qty };
        });
        
        let html = '<p><b>📝 Проверьте и исправьте ошибки:</b></p>';
        scannedItemsBuffer.forEach((item, i) => {
            html += `
            <div style="display:flex; gap:8px; margin-bottom:8px;">
                <span style="color:#999;">${i + 1}.</span>
                <input type="text" id="sn_${i}" value="${item.name.replace(/"/g, '&quot;')}" style="flex:2;">
                <input type="number" id="sq_${i}" value="${item.qty}" style="flex:1; max-width:80px;" min="1">
            </div>`;
        });
        statusDiv.innerHTML = html;
        
        const btn = document.getElementById('saveScannedBtn');
        if (btn) btn.style.display = 'block';
    } catch (err) {
        statusDiv.innerHTML = '❌ Ошибка распознавания.';
    }
}

async function saveScannedData() {
    for (let i = 0; i < scannedItemsBuffer.length; i++) {
        const name = document.getElementById(`sn_${i}`)?.value?.trim();
        const qty = parseFloat(document.getElementById(`sq_${i}`)?.value) || 1;
        if (!name) continue;
        
        const result = await localDB.allDocs({ include_docs: true });
        const existing = result.rows.find(r => r.doc.type === 'item' && r.doc.name.toLowerCase() === name.toLowerCase());
        
        let itemId;
        if (existing) {
            existing.doc.qty += qty;
            await localDB.put(existing.doc);
            itemId = existing.doc._id;
        } else {
            itemId = 'item_' + Date.now() + '_' + i;
            await localDB.put({ _id: itemId, type: 'item', name, category: '', qty, unit: 'шт', photoUrl: '', photoBase64: '' });
        }
        
        await localDB.put({
            _id: 'j_' + Date.now() + '_' + i,
            type: 'journal',
            time: new Date().toISOString(),
            user: currentUser,
            operation: 'Приход (скан)',
            itemId, itemName: name, qty,
            destination: 'Склад'
        });
        
        await saveToCloud({ action: 'addItem', id: itemId, name, qty, unit: 'шт', category: '', user: currentUser });
    }
    
    alert('✅ Сохранено!');
    document.getElementById('scanResult').style.display = 'none';
    document.getElementById('saveScannedBtn').style.display = 'none';
    renderAll();
}
