// ================== НАСТРОЙКИ ==================
const API_URL = 'https://script.google.com/macros/s/AKfycbxjay0vptPFgck6SPQ8bfKtAiI5PnP73LA1eLyYaxhP1BcTHpZogtkUvmxEVQV2jvFfDg/exec'; // ← ЗАМЕНИТЕ
// ================================================

const localDB = new PouchDB('warehouse_local');
let currentUser = localStorage.getItem('warehouse_user') || '';
let scannedItemsBuffer = [];
let isOnline = navigator.onLine;

// Статус сети
window.addEventListener('online', () => { isOnline = true; updateSyncStatus('🔄 Онлайн'); syncFromCloud(); });
window.addEventListener('offline', () => { isOnline = false; updateSyncStatus('📴 Офлайн'); });

function updateSyncStatus(msg) {
    const el = document.getElementById('syncStatus');
    if (el) el.innerHTML = msg;
}

// ================== ИНИЦИАЛИЗАЦИЯ ==================
document.addEventListener('DOMContentLoaded', async () => {
    if (!currentUser) {
        currentUser = prompt('Введите ваше имя:') || 'Гость';
        localStorage.setItem('warehouse_user', currentUser);
    }
    
    if (isOnline) await syncFromCloud();
    
    openTab('stock', null);
    renderStockList();
    renderJournal();
    
    setInterval(() => { if (isOnline) syncFromCloud(); }, 30000);
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});

// ================== СИНХРОНИЗАЦИЯ ==================
async function syncFromCloud() {
    if (!isOnline) return;
    updateSyncStatus('🔄 Загрузка из таблиц...');
    
    try {
        // Загружаем товары
        const itemsRes = await fetch(`${API_URL}?action=getItems`);
        const itemsData = await itemsRes.json();
        
        if (itemsData.items) {
            for (const item of itemsData.items) {
                if (!item.ID) continue;
                const doc = {
                    _id: item.ID,
                    type: 'item',
                    name: item['Наименование'] || '',
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
        
        // Загружаем журнал (кешируем для отображения)
        const journalRes = await fetch(`${API_URL}?action=getJournal`);
        const journalData = await journalRes.json();
        if (journalData.journal) {
            localStorage.setItem('cloud_journal', JSON.stringify(journalData.journal));
        }
        
        updateSyncStatus('✅ Данные загружены');
        renderStockList();
        renderJournal();
    } catch (err) {
        updateSyncStatus('❌ Ошибка: ' + err.message);
    }
}

// Запись в Google Таблицы
async function saveToCloud(params) {
    if (!isOnline) {
        alert('Нет интернета. Данные сохранены локально, отправятся при подключении.');
        return false;
    }
    
    const queryString = new URLSearchParams(params).toString();
    const url = `${API_URL}?${queryString}`;
    
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data.error) {
            alert('Ошибка: ' + data.error);
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
    const container = document.getElementById('stock');
    if (!container) return;
    
    const result = await localDB.allDocs({ include_docs: true });
    const items = result.rows.filter(r => r.doc.type === 'item');
    
    let html = '<h3>📦 Остатки</h3>';
    if (items.length === 0) {
        html += '<p>Склад пуст</p>';
    } else {
        for (const item of items) {
            const doc = item.doc;
            let photoHtml = '';
            if (doc.photoBase64) {
                photoHtml = `<br><img src="${doc.photoBase64}" style="max-width:120px; border-radius:5px; margin-top:5px;">`;
            } else if (doc.photoUrl) {
                photoHtml = `<br><img src="${doc.photoUrl}" style="max-width:120px; border-radius:5px; margin-top:5px;" onerror="this.style.display='none'">`;
            }
            
            html += `
            <div class="card" style="flex-direction:column; align-items:stretch;">
                <div style="display:flex; justify-content:space-between;">
                    <strong>${doc.name}</strong>
                    <span>${doc.qty} ${doc.unit}</span>
                </div>
                ${photoHtml}
                <div style="display:flex; gap:5px; margin-top:5px;">
                    <button onclick="takePhotoForItem('${doc._id}')" style="flex:1; font-size:12px;">📸 Своё фото</button>
                    <button onclick="searchPhotoForItem('${doc._id}', '${doc.name}')" style="flex:1; font-size:12px;">🔍 Фото из инета</button>
                </div>
            </div>`;
        }
    }
    container.innerHTML = html;
}

async function renderTakeList() {
    const container = document.getElementById('takeList');
    if (!container) return;
    
    const search = (document.getElementById('searchItem')?.value || '').toLowerCase();
    const result = await localDB.allDocs({ include_docs: true });
    const items = result.rows.filter(r => r.doc.type === 'item' && r.doc.name.toLowerCase().includes(search));
    
    let html = '';
    for (const item of items) {
        const doc = item.doc;
        let photoHtml = '';
        if (doc.photoBase64) {
            photoHtml = `<img src="${doc.photoBase64}" style="max-width:60px; max-height:60px; border-radius:5px;">`;
        } else if (doc.photoUrl) {
            photoHtml = `<img src="${doc.photoUrl}" style="max-width:60px; max-height:60px; border-radius:5px;" onerror="this.style.display='none'">`;
        }
        
        html += `
        <div class="card" style="flex-direction:column; align-items:stretch;">
            <div style="display:flex; align-items:center; gap:10px;">
                ${photoHtml}
                <div>
                    <strong>${doc.name}</strong>
                    <div>Остаток: ${doc.qty} ${doc.unit}</div>
                </div>
            </div>
            <div style="display:flex; gap:5px; margin-top:5px;">
                <input type="number" id="tq_${doc._id}" placeholder="Сколько" style="flex:1;" min="1" max="${doc.qty}">
                <input type="text" id="tw_${doc._id}" placeholder="Куда" style="flex:2;">
            </div>
            <button onclick="takeItem('${doc._id}', '${doc.name}')" style="margin-top:5px;">✅ Забрать</button>
        </div>`;
    }
    container.innerHTML = html || '<p>Ничего не найдено</p>';
}

async function takeItem(docId, name) {
    const qty = parseInt(document.getElementById(`tq_${docId}`)?.value);
    const dest = document.getElementById(`tw_${docId}`)?.value || 'Не указано';
    
    if (!qty || qty <= 0) return alert('Укажите количество');
    
    // Локальное обновление
    try {
        const doc = await localDB.get(docId);
        if (doc.qty < qty) return alert('Недостаточно!');
        doc.qty -= qty;
        await localDB.put(doc);
        
        // Журнал локально
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
        
        // Отправка в облако
        await saveToCloud({
            action: 'takeItem',
            id: docId,
            qty: qty,
            destination: dest,
            user: currentUser,
            name: name
        });
        
        alert('✅ Списано!');
        renderStockList();
        renderTakeList();
        renderJournal();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

async function addItem() {
    const name = document.getElementById('newName')?.value;
    const qty = parseInt(document.getElementById('newQty')?.value);
    const unit = document.getElementById('newUnit')?.value || 'шт';
    
    if (!name || !qty) return alert('Введите название и количество');
    
    const id = 'item_' + Date.now();
    
    // Локально
    await localDB.put({ _id: id, type: 'item', name, qty, unit, photoUrl: '', photoBase64: '' });
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
    
    // В облако
    await saveToCloud({
        action: 'addItem',
        id: id,
        name: name,
        qty: qty,
        unit: unit,
        user: currentUser
    });
    
    document.getElementById('newName').value = '';
    document.getElementById('newQty').value = '';
    alert('✅ Добавлено!');
    renderStockList();
    renderJournal();
}

async function renderJournal() {
    const container = document.getElementById('journal');
    if (!container) return;
    
    const result = await localDB.allDocs({ include_docs: true });
    const journal = result.rows
        .filter(r => r.doc.type === 'journal')
        .sort((a, b) => new Date(b.doc.time) - new Date(a.doc.time));
    
    let html = '<h3>📋 Журнал</h3>';
    if (journal.length === 0) {
        // Показываем из облака
        const cloudJournal = JSON.parse(localStorage.getItem('cloud_journal') || '[]');
        for (const entry of cloudJournal.slice(-30).reverse()) {
            html += `<div class="card" style="font-size:13px;">
                ${entry['ТипОперации'] === 'Расход' ? '🔴' : '🟢'} ${entry['Комментарий'] || 'Товар'} ×${entry['Количество']}<br>
                <small>${entry['Время']} | ${entry['Сотрудник']}</small>
            </div>`;
        }
    } else {
        for (const entry of journal.slice(0, 30)) {
            const doc = entry.doc;
            html += `<div class="card" style="font-size:13px;">
                ${doc.operation === 'Расход' ? '🔴' : '🟢'} ${doc.itemName} ×${doc.qty}<br>
                <small>${new Date(doc.time).toLocaleString('ru-RU')} | ${doc.user} | → ${doc.destination}</small>
            </div>`;
        }
    }
    container.innerHTML = html || '<p>Журнал пуст</p>';
}

// ================== ФОТО ==================
// Сделать своё фото
function takePhotoForItem(itemId) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.capture = 'environment'; // Задняя камера
    
    input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        // Сжимаем в Base64
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64 = ev.target.result; // Это data:image/jpeg;base64,...
            
            // Сохраняем локально
            try {
                const doc = await localDB.get(itemId);
                doc.photoBase64 = base64;
                await localDB.put(doc);
                
                // Отправляем в облако
                await saveToCloud({
                    action: 'updatePhoto',
                    id: itemId,
                    photoBase64: base64
                });
                
                alert('✅ Фото сохранено!');
                renderStockList();
                renderTakeList();
            } catch (err) {
                alert('Ошибка сохранения фото: ' + err.message);
            }
        };
        reader.readAsDataURL(file);
    };
    
    input.click();
}

// Поиск фото из интернета
async function searchPhotoForItem(itemId, itemName) {
    const query = encodeURIComponent(itemName);
    // Открываем Google Картинки
    window.open(`https://www.google.com/search?tbm=isch&q=${query}`, '_blank');
    
    // Просим пользователя вставить URL
    const url = prompt('Вставьте ссылку на фото (правый клик → "Копировать URL картинки"):');
    if (!url) return;
    
    // Проверяем, что это картинка
    if (!url.match(/\.(jpg|jpeg|png|webp|gif)/i) && !url.includes('images') && !url.includes('img')) {
        alert('Это не похоже на прямую ссылку на картинку. Попробуйте ещё раз.');
        return;
    }
    
    try {
        const doc = await localDB.get(itemId);
        doc.photoUrl = url;
        await localDB.put(doc);
        
        // Отправляем в облако
        await saveToCloud({
            action: 'updatePhoto',
            id: itemId,
            photoUrl: url
        });
        
        alert('✅ Фото из интернета сохранено!');
        renderStockList();
        renderTakeList();
    } catch (err) {
        alert('Ошибка: ' + err.message);
    }
}

// ================== РАСПОЗНАВАНИЕ ФОТО ==================
document.addEventListener('DOMContentLoaded', () => {
    const cameraInput = document.getElementById('cameraInput');
    if (!cameraInput) return;
    
    cameraInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const statusDiv = document.getElementById('scanResult');
        if (!statusDiv) return;
        
        statusDiv.innerHTML = '⏳ Распознавание... (15-40 сек)';
        
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
            
            let html = '<p><b>Исправьте ошибки:</b></p>';
            scannedItemsBuffer.forEach((item, i) => {
                html += `<div style="display:flex; gap:5px; margin-bottom:5px;">
                    <input type="text" id="sn_${i}" value="${item.name}" style="flex:2;">
                    <input type="number" id="sq_${i}" value="${item.qty}" style="flex:1;">
                </div>`;
            });
            statusDiv.innerHTML = html;
            
            const btn = document.getElementById('saveScannedBtn');
            if (btn) btn.style.display = 'block';
        } catch (err) {
            statusDiv.innerHTML = '❌ Ошибка распознавания';
        }
    });
});

async function saveScannedData() {
    for (let i = 0; i < scannedItemsBuffer.length; i++) {
        const name = document.getElementById(`sn_${i}`)?.value;
        const qty = parseFloat(document.getElementById(`sq_${i}`)?.value) || 1;
        if (!name) continue;
        
        // Ищем существующий
        const result = await localDB.allDocs({ include_docs: true });
        const existing = result.rows.find(r => r.doc.type === 'item' && r.doc.name.toLowerCase() === name.toLowerCase());
        
        let itemId;
        if (existing) {
            existing.doc.qty += qty;
            await localDB.put(existing.doc);
            itemId = existing.doc._id;
        } else {
            itemId = 'item_' + Date.now() + '_' + i;
            await localDB.put({ _id: itemId, type: 'item', name, qty, unit: 'шт', photoUrl: '', photoBase64: '' });
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
        
        await saveToCloud({ action: 'addItem', id: itemId, name, qty, unit: 'шт', user: currentUser });
    }
    
    alert('✅ Сохранено!');
    document.getElementById('scanResult').innerHTML = '';
    document.getElementById('saveScannedBtn').style.display = 'none';
    renderStockList();
    renderJournal();
}