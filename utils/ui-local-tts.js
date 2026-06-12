import {
    buildLocalSpeakerName,
    fetchLocalTtsAudio,
    fetchLocalTtsEngines,
    fetchLocalTtsVoices,
    formatLocalVoiceLabel,
    getLocalTtsConfig,
    saveLocalTtsConfig,
} from './local-tts.js';

function getEl(id) {
    return document.getElementById(id);
}

let localTtsRetryCount = 0;

function retryInitLocalTtsSettings() {
    if (localTtsRetryCount >= 20 || typeof window === 'undefined') return;
    localTtsRetryCount += 1;
    window.setTimeout(initLocalTtsSettings, 250);
}

function setStatus(message, type = 'info') {
    const el = getEl('st-is-local-tts-status');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.type = type;
}

function getErrorMessage(error) {
    if (!error) return '操作失败，请检查手机转发器是否已经启动。';
    const message = error?.message || String(error);
    if (message.includes('Failed to fetch') || message.includes('NetworkError')) {
        return '连接手机转发器失败，请确认手机和酒馆在同一网络、转发器已启动，并且地址填写正确。';
    }
    if (message.includes('AbortError')) {
        return '连接手机转发器超时，请确认转发器已启动后再试。';
    }
    return message;
}

function createPlaceholderOption(text) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    option.disabled = true;
    option.selected = true;
    return option;
}

async function runWithButton(button, busyText, action) {
    const originalText = button?.textContent;
    if (button) {
        button.disabled = true;
        button.classList.add('is-loading');
        button.textContent = busyText;
    }

    try {
        return await action();
    } catch (error) {
        setStatus(getErrorMessage(error), 'error');
        return null;
    } finally {
        if (button) {
            button.disabled = false;
            button.classList.remove('is-loading');
            button.textContent = originalText;
        }
    }
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));
}

function fillEngines(engines, selectedEngine) {
    const select = getEl('st-is-local-tts-engine');
    if (!select) return;
    select.innerHTML = '';

    if (!engines.length) {
        select.append(createPlaceholderOption('请先同步引擎'));
        return;
    }

    engines.forEach((engine) => {
        const option = document.createElement('option');
        option.value = engine.name || '';
        option.textContent = engine.label ? `${engine.label}（${engine.name}）` : engine.name;
        if (option.value === selectedEngine) option.selected = true;
        select.append(option);
    });
}

function fillVoices(voices, selectedVoice) {
    const select = getEl('st-is-local-tts-voice');
    if (!select) return;
    select.innerHTML = '';

    if (!voices.length) {
        select.append(createPlaceholderOption('请先同步音色'));
        return;
    }

    voices.forEach((voice) => {
        const option = document.createElement('option');
        option.value = voice.name || '';
        option.textContent = formatLocalVoiceLabel(voice);
        option.dataset.voice = JSON.stringify(voice);
        if (option.value === selectedVoice) option.selected = true;
        select.append(option);
    });
}

function getSelectedVoice() {
    const select = getEl('st-is-local-tts-voice');
    const option = select?.options?.[select.selectedIndex];
    if (!option) return null;

    try {
        return JSON.parse(option.dataset.voice || '{}');
    } catch {
        return { name: option.value };
    }
}

function renderSpeakerList() {
    const list = getEl('st-is-local-tts-speaker-list');
    if (!list) return;

    const config = getLocalTtsConfig();
    const speakers = Object.entries(config.speakers || {});
    if (!speakers.length) {
        list.innerHTML = '<div class="st-is-empty-state">还没有添加本地音色。</div>';
        return;
    }

    list.innerHTML = speakers.map(([name, speaker]) => `
        <div class="st-is-local-tts-speaker-row" data-speaker="${encodeURIComponent(name)}">
            <div>
                <strong>${escapeHtml(name)}</strong>
                <div class="st-is-help-text">${escapeHtml(speaker.engine || '')} / ${escapeHtml(speaker.voice || '')}</div>
            </div>
            <button type="button" class="st-is-btn secondary st-is-local-tts-remove">移除</button>
        </div>
    `).join('');
}

function removeSpeaker(button) {
    const row = button.closest('.st-is-local-tts-speaker-row');
    if (!row) return;
    const name = decodeURIComponent(row.dataset.speaker);
    const nextSpeakers = { ...(getLocalTtsConfig().speakers || {}) };
    delete nextSpeakers[name];
    saveLocalTtsConfig({ speakers: nextSpeakers });
    renderSpeakerList();
    setStatus('已移除本地音色。');
}

function readFormPatch() {
    return {
        enabled: Boolean(getEl('st-is-local-tts-enabled')?.checked),
        baseUrl: getEl('st-is-local-tts-base-url')?.value?.trim() || '',
        engine: getEl('st-is-local-tts-engine')?.value || '',
        voice: getEl('st-is-local-tts-voice')?.value || '',
        rate: Number(getEl('st-is-local-tts-rate')?.value || 50),
        pitch: Number(getEl('st-is-local-tts-pitch')?.value || 100),
    };
}

function loadForm() {
    const config = getLocalTtsConfig();
    if (getEl('st-is-local-tts-enabled')) getEl('st-is-local-tts-enabled').checked = Boolean(config.enabled);
    if (getEl('st-is-local-tts-base-url')) getEl('st-is-local-tts-base-url').value = config.baseUrl || '';
    if (getEl('st-is-local-tts-rate')) getEl('st-is-local-tts-rate').value = config.rate || 50;
    if (getEl('st-is-local-tts-pitch')) getEl('st-is-local-tts-pitch').value = config.pitch || 100;
    fillEngines(config.engines || [], config.engine);
    fillVoices(config.voices || [], config.voice);
    renderSpeakerList();
}

async function syncEngines() {
    const patch = readFormPatch();
    saveLocalTtsConfig(patch);
    setStatus('正在连接手机 TTS 转发器...');
    const engines = await fetchLocalTtsEngines(patch.baseUrl);
    const engine = engines.some((item) => item.name === patch.engine) ? patch.engine : engines[0]?.name || '';
    saveLocalTtsConfig({ ...patch, engines, engine });
    fillEngines(engines, engine);
    if (!engines.length) {
        setStatus('没有同步到本地引擎，请确认手机 TTS 服务已启动。', 'error');
        return;
    }
    setStatus(`引擎同步完成，共 ${engines.length} 个。`);
    if (engine) {
        await syncVoices();
    }
}

async function syncVoices() {
    const patch = readFormPatch();
    saveLocalTtsConfig(patch);
    setStatus('正在同步本地音色...');
    const voices = await fetchLocalTtsVoices(patch.engine, patch.baseUrl);
    const voice = voices.some((item) => item.name === patch.voice) ? patch.voice : voices[0]?.name || '';
    saveLocalTtsConfig({ ...patch, voices, voice });
    fillVoices(voices, voice);
    if (!voices.length) {
        setStatus('没有同步到本地音色，请确认手机 TTS 里已经导入语音包。', 'error');
        return;
    }
    setStatus(`本地音色同步完成，共 ${voices.length} 个。`);
}

function addCurrentVoice() {
    const patch = readFormPatch();
    const voice = getSelectedVoice();
    if (!patch.engine || !voice?.name) {
        setStatus('请先选择引擎和音色。', 'error');
        return;
    }

    const name = buildLocalSpeakerName(patch.engine, voice);
    const config = saveLocalTtsConfig({
        ...patch,
        enabled: true,
        speakers: {
            ...(getLocalTtsConfig().speakers || {}),
            [name]: {
                engine: patch.engine,
                voice: voice.name,
                locale: voice.locale || '',
                label: formatLocalVoiceLabel(voice),
            },
        },
    });

    const enabledInput = getEl('st-is-local-tts-enabled');
    if (enabledInput) enabledInput.checked = true;
    renderSpeakerList();
    setStatus(`已添加本地音色：${name}`);
    return config;
}

async function testCurrentVoice() {
    const patch = readFormPatch();
    const text = getEl('st-is-local-tts-test-text')?.value || '你好，这是本地 TTS 测试。';
    setStatus('正在合成本地测试音频...');
    const { arrayBuffer, mime } = await fetchLocalTtsAudio({
        baseUrl: patch.baseUrl,
        text,
        engine: patch.engine,
        voice: patch.voice,
        rate: patch.rate,
        pitch: patch.pitch,
    });
    const blob = new Blob([arrayBuffer], { type: mime || 'audio/x-wav' });
    const audio = getEl('st-is-local-tts-audio');
    if (!audio) {
        throw new Error('没有找到测试播放器。');
    }
    audio.src = URL.createObjectURL(blob);
    await audio.play();
    setStatus('测试音频已播放。');
}

export function initLocalTtsSettings() {
    const enabledInput = getEl('st-is-local-tts-enabled');
    if (!enabledInput) {
        retryInitLocalTtsSettings();
        return;
    }

    const root = getEl('st-is-tab-local-tts') || enabledInput.closest('.st-is-tab-content');
    if (root?.dataset.localTtsBound === 'true') {
        loadForm();
        return;
    }
    if (root) root.dataset.localTtsBound = 'true';
    localTtsRetryCount = 0;

    loadForm();

    root.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !root.contains(button)) return;

        if (button.classList.contains('st-is-local-tts-remove')) {
            removeSpeaker(button);
            return;
        }

        if (button.id === 'st-is-local-tts-save') {
            saveLocalTtsConfig(readFormPatch());
            setStatus('本地 TTS 设置已保存。');
            return;
        }

        if (button.id === 'st-is-local-tts-sync-engines') {
            runWithButton(button, '同步中...', syncEngines);
            return;
        }

        if (button.id === 'st-is-local-tts-sync-voices') {
            runWithButton(button, '同步中...', syncVoices);
            return;
        }

        if (button.id === 'st-is-local-tts-add-speaker') {
            addCurrentVoice();
            return;
        }

        if (button.id === 'st-is-local-tts-test') {
            runWithButton(button, '播放中...', testCurrentVoice);
        }
    });

    root.addEventListener('change', (event) => {
        if (event.target.matches('input, select, textarea')) {
            saveLocalTtsConfig(readFormPatch());
        }
    });
}
