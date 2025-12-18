// 從瀏覽器本地儲存讀取 IP 與設定
const DEFAULT_IP = "10.224.57.117";
let ESP32_IP = localStorage.getItem('esp32_ip') || DEFAULT_IP;

const DEFAULT_LIMIT = 30.0;
let TEMP_LIMIT = parseFloat(localStorage.getItem('temp_limit')) || DEFAULT_LIMIT;

const tempUrl = () => `http://${ESP32_IP}/temperature`;
const fanUrl = () => `http://${ESP32_IP}/fan`; 
const autoModeUrl = () => `http://${ESP32_IP}/mode/auto`;
const thresholdUrl = () => `http://${ESP32_IP}/threshold`; 
const voltageUrl = () => `http://${ESP32_IP}/v`; 

let isManualOverride = false; 
let flickerTimer = null; 
let flickerState = true; 

// 元素快取
const tempElement = document.getElementById("temp");
const statusElement = document.getElementById("status");
const fanBtnElement = document.getElementById("fanBtn");
const voltageElement = document.getElementById("voltage");
const batteryLevelElement = document.getElementById("batteryLevel");

// Modals
const statusModal = document.getElementById('statusModal');
const modalTitle = document.getElementById('modalTitle');
const modalMessage = document.getElementById('modalMessage');
const modalCloseBtn = document.getElementById('modalCloseBtn');
const configModal = document.getElementById('configModal');
const saveConfigBtn = document.getElementById('saveConfigBtn');

// --- 功能函式 ---

function showStatusModal(title, message, isSuccess) {
    if (!statusModal) return;
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modalTitle.style.color = isSuccess ? '#0078d7' : '#e53935'; 
    statusModal.style.display = 'flex'; 
}

function closeStatusModal() { statusModal.style.display = 'none'; }

function startFlicker() {
    if (flickerTimer) return;
    flickerTimer = setInterval(() => {
        flickerState = !flickerState;
        statusElement.textContent = flickerState ? `更新：${new Date().toLocaleTimeString()}` : "(手動模式)";
    }, 500);
}

function stopFlicker() {
    if (flickerTimer) { clearInterval(flickerTimer); flickerTimer = null; }
    statusElement.textContent = `更新時間：${new Date().toLocaleTimeString()} (自動模式)`;
}

async function fetchTemp(){
    try {
        const res = await fetch(tempUrl());
        const data = await res.json();
        const currentTemp = parseFloat(data.temp);

        if (isNaN(currentTemp)) {
             tempElement.textContent = "NAN";
        } else {
             tempElement.textContent = currentTemp.toFixed(1);
             tempElement.style.color = currentTemp >= TEMP_LIMIT ? "red" : "#0078d7"; 
        }

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
        tempElement.textContent = "--";
        statusElement.textContent = `連線失敗 (IP: ${ESP32_IP})`;
    }
}

async function fetchVoltage(){
    try {
        const res = await fetch(voltageUrl()); 
        const data = await res.json();
        const v = parseFloat(data.voltage); 

        if (isNaN(v)) {
             voltageElement.textContent = "NAN";
             batteryLevelElement.style.width = "0%";
             return;
        }

        voltageElement.textContent = v.toFixed(2);
        voltageElement.style.color = v < 11.1 ? "red" : "#0078d7";

        // 電量百分比計算 (假設 3S 18650: 9.0V=0%, 12.6V=100%)
        const minV = 3;
        const maxV = 4.2;
        let percent = ((v - minV) / (maxV - minV)) * 100;
        percent = Math.max(0, Math.min(100, percent)); // 限制 0-100

        batteryLevelElement.style.width = percent + "%";
        
        // 根據電量變色
        if (percent < 20) batteryLevelElement.style.backgroundColor = "#e53935";
        else if (percent < 50) batteryLevelElement.style.backgroundColor = "#f7b731";
        else batteryLevelElement.style.backgroundColor = "#4caf50";

    } catch(e){
        voltageElement.textContent = "--";
        batteryLevelElement.style.width = "0%";
    }
}

async function toggleFanHandler(){
    fanBtnElement.disabled = true; 
    try {
        if (!isManualOverride) {
            await fetch(fanUrl(), { method: "OPTIONS" }); 
            await fetch(fanUrl(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ on: true })
            });
            isManualOverride = true;
            showStatusModal("成功", "已開啟手動模式", true);
        } else {
            await fetch(autoModeUrl());
            isManualOverride = false;
            showStatusModal("成功", "已返回自動模式", true);
        }
    } catch(e) {
        showStatusModal("錯誤", "操作失敗", false);
    }
    fanBtnElement.disabled = false;
    fetchTemp(); 
}

async function saveConfigHandler() {
    const newIP = document.getElementById('ipInput').value.trim();
    const newLimit = parseFloat(document.getElementById('tempLimitInput').value);

    if (newIP) { localStorage.setItem('esp32_ip', newIP); ESP32_IP = newIP; }
    if (!isNaN(newLimit)) { localStorage.setItem('temp_limit', newLimit); TEMP_LIMIT = newLimit; }

    try {
        await fetch(thresholdUrl(), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ temp: newLimit })
        });
        showStatusModal("儲存成功", "設定已同步至 ESP32", true);
        configModal.style.display = 'none';
    } catch (e) {
        showStatusModal("儲存提醒", "本地已儲存，但無法同步至 ESP32 (請檢查連線)", false);
    }
}

// 初始化
fanBtnElement.onclick = toggleFanHandler;
saveConfigBtn.onclick = saveConfigHandler;
document.querySelector('.info-close').onclick = () => document.getElementById('infoModal').style.display='none';
document.querySelector('.config-close').onclick = () => document.getElementById('configModal').style.display='none';
document.getElementById('infoBtn').onclick = () => document.getElementById('infoModal').style.display='flex';
document.getElementById('configBtn').onclick = () => {
    document.getElementById('configModal').style.display='flex';
    document.getElementById('ipInput').value = ESP32_IP;
    document.getElementById('tempLimitInput').value = TEMP_LIMIT;
};
modalCloseBtn.onclick = closeStatusModal;

setInterval(fetchTemp, 2000);
setInterval(fetchVoltage, 2000);
fetchTemp();
fetchVoltage();