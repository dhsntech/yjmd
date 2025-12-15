// 從瀏覽器本地儲存讀取 IP，如果沒有則使用預設值
const DEFAULT_IP = "10.224.57.117"; // *** 確保使用您目前的實際 IP ***
let ESP32_IP = localStorage.getItem('esp32_ip') || DEFAULT_IP;

// 從瀏覽器本地儲存讀取溫度閥值
const DEFAULT_LIMIT = 30.0;
let TEMP_LIMIT = parseFloat(localStorage.getItem('temp_limit')) || DEFAULT_LIMIT;

// 函式用於動態生成 URL，以確保使用最新的 ESP32_IP
const tempUrl = () => `http://${ESP32_IP}/temperature`;
const fanUrl = () => `http://${ESP32_IP}/fan`; 
const autoModeUrl = () => `http://${ESP32_IP}/mode/auto`;
const thresholdUrl = () => `http://${ESP32_IP}/threshold`; 
const voltageUrl = () => `http://${ESP32_IP}/v`; 

// --- 控制變數 ---
let isManualOverride = false; 
let flickerTimer = null; 
let flickerState = true; 

// --- 元素快取 ---
const tempElement = document.getElementById("temp"); // <-- 溫度顯示元素
const statusElement = document.getElementById("status");
const fanBtnElement = document.getElementById("fanBtn");
const voltageElement = document.getElementById("voltage"); // <-- 電壓顯示元素


// 客製化狀態彈出視窗的元素
const statusModal = document.getElementById('statusModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const statusCloseBtn = document.getElementsByClassName('status-close')[0];

// *** Modal 相關元素快取 ***
const infoModal = document.getElementById('infoModal');
const infoBtn = document.getElementById('infoBtn');
const infoCloseBtn = document.getElementsByClassName('info-close')[0];

// *** 設定 Modal 相關元素快取 ***
const configModal = document.getElementById('configModal');
const configBtn = document.getElementById('configBtn');
const configCloseBtn = document.getElementsByClassName('config-close')[0];
const tempLimitInput = document.getElementById('tempLimitInput');
const ipInput = document.getElementById('ipInput'); 
const saveConfigBtn = document.getElementById('saveConfigBtn');
const configStatusMessage = document.getElementById('configStatusMessage');
const currentTempLimitStatus = document.getElementById('currentTempLimitStatus');
const currentIPStatus = document.getElementById('currentIPStatus'); 


// --- 客製化 Modal 顯示/關閉函式 ---
function showStatusModal(title, message, isSuccess) {
    if (!statusModal) return;
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalTitle.style.color = isSuccess ? '#0078d7' : '#e53935'; 
    if (modalCloseBtn) modalCloseBtn.style.background = isSuccess ? '#0078d7' : '#e53935';
    statusModal.style.display = 'flex'; 
}

function closeStatusModal() {
    if (statusModal) statusModal.style.display = 'none';
}

// ------------------------------------
// (核心功能函式)
// ------------------------------------

/**
 * 處理狀態文字閃爍效果 
 */
function startFlicker() {
    if (flickerTimer) return;
    flickerTimer = setInterval(() => {
        flickerState = !flickerState;
        const timeStr = `更新時間：${new Date().toLocaleTimeString()}`;
        const modeStr = "(手動散熱模式)"; 
        statusElement.textContent = flickerState ? timeStr : modeStr;
    }, 500);
}

/**
 * 停止閃爍 
 */
function stopFlicker() {
    if (flickerTimer) {
        clearInterval(flickerTimer);
        flickerTimer = null;
    }
    statusElement.textContent = `更新時間：${new Date().toLocaleTimeString()} (自動模式)`;
}


/**
 * 讀取溫度數據並更新介面 (已修正為顯示數值)
 */
async function fetchTemp(){
    try {
        const res = await fetch(tempUrl());
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        const currentTemp = data.temp; // 取得溫度數值

        // *** 溫度顯示邏輯 ***
        if (isNaN(currentTemp) || currentTemp === "NAN") {
             tempElement.textContent = "NAN";
             tempElement.style.color = "gray";
        } else {
             // 顯示溫度，並根據閥值進行顏色判斷
             const tempValue = parseFloat(currentTemp);
             tempElement.textContent = tempValue.toFixed(1);
             // 高於設定閥值時顯示紅色警告
             tempElement.style.color = tempValue >= TEMP_LIMIT ? "red" : "#0078d7"; 
        }

        // 模式顯示邏輯
        if (data.mode === 'manual' || isManualOverride) { 
            isManualOverride = true; 
            fanBtnElement.textContent = "切換回自動模式";
            startFlicker();
        } else {
            isManualOverride = false; 
            fanBtnElement.textContent = "手動開啟風扇";
            stopFlicker();
        }
        
    } catch(e){
        // 連線失敗時顯示 IP 錯誤提示
        tempElement.textContent = "--";
        tempElement.style.color = "gray";
        statusElement.textContent = `讀取失敗：Failed to fetch。請檢查 IP (${ESP32_IP}) 是否正確。`;
        console.error("Fetch Temp Error:", e);
        stopFlicker(); 
    }
}


/**
 * 讀取電壓數據並更新介面 
 */
async function fetchVoltage(){
    try {
        const res = await fetch(voltageUrl()); 
        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        const data = await res.json();
        const currentVoltage = data.voltage; 

        // 檢查數據是否有效
        if (isNaN(currentVoltage) || currentVoltage === "NAN") {
             voltageElement.textContent = "NAN";
             voltageElement.style.color = "gray";
             console.error("INA219 Voltage Read Error: NAN received.");
             return;
        }

        // 顯示電壓，並進行顏色判斷
        voltageElement.textContent = parseFloat(currentVoltage).toFixed(2);
        voltageElement.style.color = parseFloat(currentVoltage) < 11.5 ? "red" : "#0078d7";  // 低於11.5V變紅

    } catch(e){
        voltageElement.textContent = "--";
        voltageElement.style.color = "gray";
        console.error("Fetch Voltage Error:", e);
    }
}

/**
 * 發送手動控制指令給 ESP32 (已加入 OPTIONS 預檢)
 */
async function controlFan(state) {
    // 解決 CORS: 先發送一個 OPTIONS 預檢請求
    await fetch(fanUrl(), { method: "OPTIONS" }); 

    const res = await fetch(fanUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ on: state })
    });
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const result = await res.json();
    return result.on;
}

/**
 * 發送切換回自動模式指令給 ESP32 
 */
async function setAutoMode() {
    const res = await fetch(autoModeUrl());
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`); 
    return true;
}


/**
 * 處理按鈕點擊，切換模式 (核心邏輯)
 */
// ... (所有變數和輔助函式保持不變) ...

/**
 * 處理按鈕點擊，切換模式 (核心邏輯)
 */
async function toggleFanHandler(){
    // 步驟 1: 點擊後立即禁用按鈕，防止重複點擊
    fanBtnElement.disabled = true; 
    
    try {
        if (!isManualOverride) {
            // 從自動模式切換到手動模式 (開啟風扇)
            await controlFan(true);
            isManualOverride = true;
            fanBtnElement.textContent = "切換回自動模式";
            showStatusModal("操作成功", "已切換至手動模式並開啟風扇。", true);
        } else {
            // 從手動模式切換回自動模式
            await setAutoMode();
            isManualOverride = false;
            fanBtnElement.textContent = "手動開啟風扇";
            showStatusModal("操作成功", "已切換回自動溫控模式。", true);
        }
    } catch(e) {
        showStatusModal("操作失敗", `模式切換失敗：${e.message}。請確認 IP (${ESP32_IP}) 正確且連線正常。`, false);
        console.error("Mode Toggle Error:", e);
    }
    
    // 步驟 2: 無論成功或失敗，都重新啟用按鈕，並立即更新狀態
    fanBtnElement.disabled = false;
    fetchTemp(); 
}

// ... (其餘函式和初始化保持不變) ...

// ------------------------------------
// (本地配置儲存函式)
// ------------------------------------

/**
 * 載入本地儲存配置並更新設定視窗
 */
function loadLocalConfigToUI() {
    tempLimitInput.value = TEMP_LIMIT.toFixed(1);
    ipInput.value = ESP32_IP;
    
    currentTempLimitStatus.textContent = `當前設定: ${TEMP_LIMIT.toFixed(1)} °C`;
    currentIPStatus.textContent = `當前連線 IP: ${ESP32_IP}`;
    configStatusMessage.textContent = `配置已從瀏覽器載入。`;
    configStatusMessage.style.color = 'green';
}

/**
 * 網頁載入時，將本地儲存的閥值同步發送給 ESP32。
 */
async function syncThresholdToESP32() {
    console.log(`Attempting to sync threshold (${TEMP_LIMIT.toFixed(1)} °C) to ESP32 at ${ESP32_IP} on load...`);
    try {
        // 1. OPTIONS 預檢
        await fetch(thresholdUrl(), { method: "OPTIONS" }); 
        
        // 2. POST 實際數據
        const res = await fetch(thresholdUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ temp: TEMP_LIMIT })
        });

        if (!res.ok) {
            throw new Error(`HTTP error! status: ${res.status}`);
        }
        
        const result = await res.json();
        if (result && result.status === 'ok') {
            console.log("Threshold successfully synchronized to ESP32 on load.");
        } else {
            throw new Error(result.message || "Unknown error during sync.");
        }

    } catch (e) {
        console.error(`[SYNC ERROR] 啟動時同步閥值到 ESP32 失敗。請檢查 IP (${ESP32_IP}) 和連線。Error: ${e.message}`);
    }
}


/**
 * 儲存配置至瀏覽器 Local Storage 並發送給 ESP32
 */
async function saveConfigHandler() { 
    configStatusMessage.textContent = '正在儲存至瀏覽器...';
    configStatusMessage.style.color = 'orange';
    saveConfigBtn.disabled = true;

    try {
        const newTempLimit = parseFloat(tempLimitInput.value);
        const newIP = ipInput.value.trim();
        let esp32UpdateSuccess = false;

        // 1. 儲存 IP 位址 (本地儲存)
        if (newIP) {
            localStorage.setItem('esp32_ip', newIP);
            ESP32_IP = newIP;
        }

        // 2. 儲存溫度閥值 (本地儲存)
        if (!isNaN(newTempLimit)) {
            localStorage.setItem('temp_limit', newTempLimit.toFixed(1));
            TEMP_LIMIT = newTempLimit;
        }
        
        // 3. 呼叫 ESP32 API 更新閥值 (使用新 IP)
        try {
            await fetch(thresholdUrl(), { method: "OPTIONS" }); // 預檢
            const res = await fetch(thresholdUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ temp: newTempLimit })
            });
            
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            const result = await res.json();
            if (result && result.status === 'ok') {
                 esp32UpdateSuccess = true;
            } else {
                 throw new Error(result.message || "Unknown error from ESP32.");
            }
        } catch (e) {
            console.error("ESP32 Threshold Update Failed:", e);
        }

        loadLocalConfigToUI(); // 更新介面顯示
        
        let message = "設定已儲存至瀏覽器。";
        if (esp32UpdateSuccess) {
            message += " 閥值已成功更新到 ESP32！";
            configStatusMessage.textContent = '設定已儲存！閥值已更新到 ESP32。';
            configStatusMessage.style.color = 'blue';
            
            // *** 成功時關閉設定介面 ***
            configModal.style.display = 'none'; 
            
        } else {
            message += " **警告：閥值更新到 ESP32 失敗**。請確認 IP 正確且連線正常。";
            configStatusMessage.textContent = '設定已儲存！但閥值更新到 ESP32 失敗。';
            configStatusMessage.style.color = 'red';
            // 失敗時保持 configModal 開啟，讓使用者可以重新嘗試
        }

        // 無論成功或失敗，都顯示狀態提示小視窗
        showStatusModal("儲存完成", message, esp32UpdateSuccess);

    } catch (e) {
        configStatusMessage.textContent = `儲存失敗: ${e.message}`;
        configStatusMessage.style.color = 'red';
        showStatusModal("儲存失敗", `儲存配置時發生錯誤: ${e.message}`, false);
        console.error("Save Config Error:", e);
    }
    
    saveConfigBtn.disabled = false;
}


// --- 初始化 ---

// 1. 綁定按鈕事件
fanBtnElement.addEventListener("click", toggleFanHandler);
if (modalCloseBtn) modalCloseBtn.addEventListener("click", closeStatusModal);
if (statusCloseBtn) statusCloseBtn.addEventListener("click", closeStatusModal);

// 2. 綁定 Info Modal 事件
if (infoBtn) infoBtn.addEventListener("click", () => {
    infoModal.style.display = 'flex';
});
if (infoCloseBtn) infoCloseBtn.addEventListener("click", () => {
    infoModal.style.display = 'none';
});

// 3. 綁定 設定 Modal 事件
if (configBtn) configBtn.addEventListener("click", () => {
    configModal.style.display = 'flex'; 
    loadLocalConfigToUI(); // 開啟時載入本地配置
});
if (configCloseBtn) configCloseBtn.addEventListener("click", () => {
    configModal.style.display = 'none'; 
});

// 4. 綁定設定儲存按鈕
if (saveConfigBtn) saveConfigBtn.addEventListener("click", saveConfigHandler);

// 5. 啟動溫度讀取 (用於模式切換狀態及數值顯示)
setInterval(fetchTemp, 500); 
fetchTemp();

// 6. 啟動電壓讀取 
setInterval(fetchVoltage, 500);
fetchVoltage(); // 立即讀取一次

// 7. 網頁載入時，立即將本地閥值同步給 ESP32 (確保 ESP32 使用最新設定)
syncThresholdToESP32();