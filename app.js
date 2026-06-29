// ================== НАСТРОЙКИ ==================
const SPREADSHEET_ID = '1zqf4QEZGhmFgb1uOAe_F3DyckGkgZeN62UhmUNxuEFA';
const API_KEY = 'AIzaSyAGNT2CQQzmyU5Hz4Z6hcE34LtHE10H_yc';
// ==================================================================

// Локальная база данных в телефоне
const localDB = new PouchDB('warehouse_local');

// Переменные приложения
let currentUser = localStorage.getItem('warehouse_user') || 'Неизвестный';
let scannedItemsBuffer = [];

// ================== 1. ИНИЦИАЛИЗАЦИЯ ==================
document.addEventListener('DOMContentLoaded', () => {
    if (!currentUser || currentUser === 'Неизвестный') {
        currentUser = prompt('Введите ваше имя для журнала:') || 'Гость';
        localStorage.setItem('warehouse_user', currentUser);
    }
    openTab('stock', null); // <-- ПЕРЕДАЕМ event = null
    
    syncData();
    setInterval(syncData, 30000);
    
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('sw.js');
    }
});

// ================== 2. СИНХРОНИЗАЦИЯ ==================
async function syncData() {
    const status = document.getElementById('syncStatus');
    
    if (!navigator.onLine) {
        status.innerHTML = '📴 Офлайн. Работаем с локальной копией.';
        return;
    }

    status.innerHTML = '🔄 Синхронизация...';
    
    try {
        // Загружаем Товары
        const itemsRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Товары?key=${API_KEY}`);
        const itemsData = await itemsRes.json();
        
        if (itemsData.values && itemsData.values.length > 1) {
            for (let i = 1; i < itemsData.values.length; i++) {
                const row = itemsData.values[i];
                const doc = {
                    _id: `item_${row[0]}`,
                    type: 'item',
                    name: row[1],
                    category: row[2],
                    unit: row[3],
                    qty: parseInt(row[4]) || 0,
                    photoUrl: row[5] || ''
                    // photoBase64: row[6] || ''  // УБРАЛИ ДЛЯ ЭКОНОМИИ МЕСТА
                };
                try {
                    const existing = await localDB.get(doc._id);
                    doc._rev = existing._rev;
                } catch (e) {}
                await localDB.put(doc);
            }
        }

        // Загружаем Журнал
        const journalRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Журнал?key=${API_KEY}`);
        const journalData = await journalRes.json();
        if (journalData.values) {
            localStorage.setItem('cached_journal', JSON.stringify(journalData.values));
        }

        // Загружаем Сотрудников
        try {
            const employeesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/Сотрудники?key=${API_KEY}`);
            const employeesData = await employeesRes.json();
            if (employeesData.values) {
                localStorage.setItem('cached_employees', JSON.stringify(employeesData.values));
                console.log('✅ Сотрудники загружены:', employeesData.values.length);
            }
        } catch (e) {
            console.warn('Не удалось загрузить лист "Сотрудники"');
        }
        
        status.innerHTML = '✅ Синхронизировано. Данные актуальны.';
        renderStockList();
        renderJournal();
    } catch (error) {
        status.innerHTML = '❌ Ошибка синхронизации. Проверьте ID таблицы и ключ.';
        console.error('Ошибка:', error);
    }
}

// ================== 3. ИНТЕРФЕЙС ==================
function openTab(tabId, event) {  // <-- ДОБАВИЛИ ПАРАМЕТР event
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    
    // Проверяем, есть ли event
    if (event && event.target) {
        event.target.classList.add('active');
    }
    
    if (tabId === 'stock') renderStockList();
    if (tabId === 'take') renderTakeList();
    if (tabId === 'journal') renderJournal();
}

async function renderStockList() {
    const container = document.getElementById('stock');
    try {
        const result = await localDB.allDocs({ include_docs: true });
        const items = result.rows.filter(row => row.doc.type === 'item');
        
        let html = '<h3>Остатки на складе</h3>';
        if (items.length === 0) {
            html += '<p>Склад пуст. Добавьте товары через "Приход".</p>';
        }
        items.forEach(item => {
            html += `
            <div class="card">
                <div>
                    <strong>${item.doc.name}</strong> (${item.doc.qty} ${item.doc.unit})
                    ${item.doc.photoUrl ? `<img src="${item.doc.photoUrl}" class="preview-img" onerror="this.style.display='none'">` : ''}
                </div>
                <button class="danger" onclick="deleteItem('${item.doc._id}')">Удалить</button>
            </div>`;
        });
        container.innerHTML = html;
        renderTakeList();
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки данных</p>';
        console.error(e);
    }
}

function renderTakeList() {
    const container = document.getElementById('takeList');
    const searchText = document.getElementById('searchItem')?.value?.toLowerCase() || '';
    localDB.allDocs({ include_docs: true }).then(result => {
        const items = result.rows.filter(row => row.doc.type === 'item' && row.doc.name.toLowerCase().includes(searchText));
        let html = '';
        if (items.length === 0) {
            html = '<p>Ничего не найдено</p>';
        }
        items.forEach(item => {
            html += `
            <div class="card">
                <strong>${item.doc.name}</strong> (Остаток: ${item.doc.qty})
                <input type="number" id="takeQty_${item.doc._id}" placeholder="Кол-во" style="width:60px" min="1" max="${item.doc.qty}">
                <input type="text" id="takeWhere_${item.doc._id}" placeholder="Куда/Задача">
                <button onclick="takeItem('${item.doc._id}')">Забрать</button>
            </div>`;
        });
        container.innerHTML = html;
    }).catch(e => {
        container.innerHTML = '<p>Ошибка загрузки</p>';
        console.error(e);
    });
}

// ================== 4. ОПЕРАЦИИ ==================
async function takeItem(docId) {
    const qtyInput = document.getElementById(`takeQty_${docId}`);
    const whereInput = document.getElementById(`takeWhere_${docId}`);
    const qty = parseInt(qtyInput?.value);
    const where = whereInput?.value || 'Не указано';

    if (!qty || qty <= 0) return alert('Укажите корректное количество');
    
    try {
        const doc = await localDB.get(docId);
        if (doc.qty < qty) return alert('Недостаточно на складе!');
        
        doc.qty -= qty;
        await localDB.put(doc);
        
        const journalEntry = {
            _id: `journal_${Date.now()}`,
            type: 'journal',
            time: new Date().toISOString(),
            user: currentUser,
            operation: 'Расход',
            itemId: docId,
            itemName: doc.name,
            qty: qty,
            destination: where
        };
        await localDB.put(journalEntry);
        await localDB.put({ _id: `pending_${Date.now()}`, data: journalEntry, sheet: 'Журнал' });
        await localDB.put({ _id: `pending_item_${docId}`, data: doc, sheet: 'Товары' });
        
        alert(`✅ ${doc.name} x${qty} списано.`);
        renderStockList();
        renderJournal();
    } catch (err) {
        alert('Ошибка операции: ' + err.message);
    }
}

async function addItem() {
    const name = document.getElementById('newName').value.trim();
    const qty = parseInt(document.getElementById('newQty').value);
    const unit = document.getElementById('newUnit').value.trim() || 'шт';
    
    if (!name) return alert('Введите название товара');
    if (!qty || qty <= 0) return alert('Введите корректное количество');
    
    const newId = `item_${Date.now()}`;
    const doc = {
        _id: newId,
        type: 'item',
        name: name,
        category: '',
        unit: unit,
        qty: qty,
        photoUrl: '',
        photoBase64: ''
    };
    await localDB.put(doc);
    await localDB.put({ _id: `pending_${Date.now()}`, data: doc, sheet: 'Товары' });
    
    document.getElementById('newName').value = '';
    document.getElementById('newQty').value = '';
    alert(`✅ ${name} добавлен на склад.`);
    renderStockList();
}

async function renderJournal() {
    const container = document.getElementById('journal');
    try {
        const result = await localDB.allDocs({ include_docs: true });
        const journal = result.rows
            .filter(row => row.doc.type === 'journal')
            .sort((a, b) => b.doc.time.localeCompare(a.doc.time));
        
        let html = '<h3>Последние операции</h3>';
        if (journal.length === 0) {
            html += '<p>Журнал пуст</p>';
        }
        journal.slice(0, 20).forEach(entry => {
            html += `<div class="card"><strong>${entry.doc.itemName}</strong> (${entry.doc.qty}) -> ${entry.doc.destination}<br><small>${new Date(entry.doc.time).toLocaleString()} | ${entry.doc.user}</small></div>`;
        });
        container.innerHTML = html;
    } catch (e) {
        container.innerHTML = '<p>Ошибка загрузки журнала</p>';
        console.error(e);
    }
}

// ================== 5. РАСПОЗНАВАНИЕ ФОТО ==================
document.getElementById('cameraInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const statusDiv = document.getElementById('scanResult');
    statusDiv.innerHTML = '⏳ Идет распознавание... (может занять 10-30 сек)';
    
    try {
        const worker = await Tesseract.createWorker('rus');
        const { data: { text } } = await worker.recognize(file);
        await worker.terminate();
        
        const lines = text.split('\n').filter(line => line.trim() !== '');
        scannedItemsBuffer = lines.map(line => {
            const parts = line.trim().split(' ');
            const qty = parseFloat(parts[parts.length - 1]);
            const name = isNaN(qty) ? line.trim() : parts.slice(0, -1).join(' ');
            return { name: name || 'Неизвестно', qty: isNaN(qty) ? 1 : qty };
        });
        
        let html = '<p><b>Распознано. Исправьте ошибки перед сохранением:</b></p>';
        scannedItemsBuffer.forEach((item, index) => {
            html += `<input type="text" id="scanName_${index}" value="${item.name}" placeholder="Название">
                     <input type="number" id="scanQty_${index}" value="${item.qty}" placeholder="Кол-во" style="width:70px"><br>`;
        });
        statusDiv.innerHTML = html;
        document.getElementById('saveScannedBtn').style.display = 'block';
        
    } catch (err) {
        statusDiv.innerHTML = '❌ Ошибка распознавания. Попробуйте фото с лучшим освещением и текстом.';
        console.error(err);
    }
});

async function saveScannedData() {
    for (let i = 0; i < scannedItemsBuffer.length; i++) {
        const name = document.getElementById(`scanName_${i}`)?.value?.trim();
        const qty = parseFloat(document.getElementById(`scanQty_${i}`)?.value) || 1;
        
        if (!name) continue;
        
        const result = await localDB.allDocs({ include_docs: true });
        const existingItem = result.rows.find(row => row.doc.type === 'item' && row.doc.name.toLowerCase() === name.toLowerCase());
        
        if (existingItem) {
            existingItem.doc.qty += qty;
            await localDB.put(existingItem.doc);
        } else {
            const newId = `item_${Date.now()}_${i}`;
            await localDB.put({ _id: newId, type: 'item', name: name, qty: qty, unit: 'шт' });
        }
        await localDB.put({ _id: `journal_${Date.now()}_${i}`, type: 'journal', time: new Date().toISOString(), user: currentUser, operation: 'Приход (скан)', itemName: name, qty: qty, destination: 'Склад' });
    }
    
    alert('✅ Отсканированные позиции добавлены!');
    document.getElementById('scanResult').innerHTML = '';
    document.getElementById('saveScannedBtn').style.display = 'none';
    renderStockList();
}

// Удаление товара (добавим для полноты)
async function deleteItem(docId) {
    if (!confirm('Удалить товар?')) return;
    try {
        const doc = await localDB.get(docId);
        await localDB.remove(doc);
        renderStockList();
    } catch (e) {
        alert('Ошибка удаления');
    }
}
