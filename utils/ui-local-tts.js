import {
    LOCAL_TTS_RESOURCE_ID,
    buildLocalSpeakerName,
    fetchLocalTtsAudio,
    fetchLocalTtsEngines,
    fetchLocalTtsVoices,
    formatLocalVoiceLabel,
    getLocalTtsConfig,
    removeLocalTtsSpeakerFromMainTts,
    saveLocalTtsConfig,
    syncLocalTtsSpeakersToMainTts,
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

function setMainStatus(message, type = 'info') {
    const el = getEl('st-is-main-local-tts-status');
    if (!el) return;
    el.textContent = message || '';
    el.dataset.type = type;
}

function setAllStatus(message, type = 'info') {
    setStatus(message, type);
    setMainStatus(message, type);
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
        setAllStatus(getErrorMessage(error), 'error');
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

function fillMainEngines(engines, selectedEngine) {
    const select = getEl('st-is-main-local-tts-engine');
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

function fillMainVoices(voices, selectedVoice) {
    const select = getEl('st-is-main-local-tts-voice');
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

function getSelectedMainVoice() {
    const select = getEl('st-is-main-local-tts-voice');
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
    removeLocalTtsSpeakerFromMainTts(name);
    renderSpeakerList();
    setAllStatus('已移除本地音色，并从主音色列表同步清理。');
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

function readMainFormPatch() {
    return {
        enabled: true,
        baseUrl: getEl('st-is-main-local-tts-base-url')?.value?.trim() || '',
        engine: getEl('st-is-main-local-tts-engine')?.value || '',
        voice: getEl('st-is-main-local-tts-voice')?.value || '',
        rate: Number(getEl('st-is-main-local-tts-rate')?.value || 50),
        pitch: Number(getEl('st-is-main-local-tts-pitch')?.value || 100),
    };
}

function loadMainForm() {
    const root = getEl('st-is-main-local-tts-root');
    if (!root) return;

    const config = getLocalTtsConfig();
    if (getEl('st-is-main-local-tts-base-url')) getEl('st-is-main-local-tts-base-url').value = config.baseUrl || '';
    if (getEl('st-is-main-local-tts-rate')) getEl('st-is-main-local-tts-rate').value = config.rate || 50;
    if (getEl('st-is-main-local-tts-pitch')) getEl('st-is-main-local-tts-pitch').value = config.pitch || 100;
    fillMainEngines(config.engines || [], config.engine);
    fillMainVoices(config.voices || [], config.voice);
    syncExistingLocalSpeakersToMain(config);
}

function ensureMainResourceOption() {
    const select = getEl('tts_resource_id_select');
    if (!select || Array.from(select.options).some((option) => option.value === LOCAL_TTS_RESOURCE_ID)) return;

    const option = document.createElement('option');
    option.value = LOCAL_TTS_RESOURCE_ID;
    option.textContent = '本地 TTS（手机语音包）';
    select.append(option);
}

function reflectMainSpeakerSelection(speaker) {
    if (!speaker) return;
    ensureMainResourceOption();

    const select = getEl('tts_speaker_profile_select');
    if (select && !Array.from(select.options).some((option) => option.value === speaker.name)) {
        const option = document.createElement('option');
        option.value = speaker.name;
        option.textContent = speaker.name;
        select.append(option);
    }
    if (select) select.value = speaker.name;

    if (getEl('tts_speaker_profile_name')) getEl('tts_speaker_profile_name').value = speaker.name;
    if (getEl('tts_speaker_id')) getEl('tts_speaker_id').value = speaker.voice || speaker.speaker_id || '';
    if (getEl('tts_resource_id_select')) getEl('tts_resource_id_select').value = LOCAL_TTS_RESOURCE_ID;
    if (getEl('tts_speaker_description')) {
        getEl('tts_speaker_description').value = speaker.description || '本地 TTS 转发器音色';
    }
}

function syncExistingLocalSpeakersToMain(config = getLocalTtsConfig()) {
    if (!config.enabled || !Object.keys(config.speakers || {}).length) return;

    try {
        const result = syncLocalTtsSpeakersToMainTts();
        setMainStatus(`已同步 ${result.count} 个本地音色到主音色列表。`);
    } catch {
        // 旧设置没有完整引擎/音色时，等用户重新选择后再同步。
    }
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

async function syncMainEngines() {
    const patch = readMainFormPatch();
    saveLocalTtsConfig(patch);
    setMainStatus('正在连接手机 TTS 转发器...');
    const engines = await fetchLocalTtsEngines(patch.baseUrl);
    const engine = engines.some((item) => item.name === patch.engine) ? patch.engine : engines[0]?.name || '';
    saveLocalTtsConfig({ ...patch, engines, engine });
    fillMainEngines(engines, engine);
    if (!engines.length) {
        setMainStatus('没有同步到本地引擎，请确认手机 TTS 服务已启动。', 'error');
        return;
    }
    setMainStatus(`引擎同步完成，共 ${engines.length} 个。`);
    if (engine) {
        await syncMainVoices();
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

async function syncMainVoices() {
    const patch = readMainFormPatch();
    saveLocalTtsConfig(patch);
    setMainStatus('正在同步本地音色...');
    const voices = await fetchLocalTtsVoices(patch.engine, patch.baseUrl);
    const voice = voices.some((item) => item.name === patch.voice) ? patch.voice : voices[0]?.name || '';
    saveLocalTtsConfig({ ...patch, voices, voice });
    fillMainVoices(voices, voice);
    if (!voices.length) {
        setMainStatus('没有同步到本地音色，请确认手机 TTS 里已经导入语音包。', 'error');
        return;
    }
    setMainStatus(`本地音色同步完成，共 ${voices.length} 个。`);
}

function syncSpeakerToMainList(name) {
    const result = syncLocalTtsSpeakersToMainTts([name]);
    reflectMainSpeakerSelection(result.speakers[0]);
    document.dispatchEvent(new CustomEvent('st-is:local-tts-speakers-updated', { detail: result }));
    return result;
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
    syncSpeakerToMainList(name);
    setAllStatus(`已添加到主音色列表：${name}。角色匹配和 LLM 文本提取会继续生效。`);
    return config;
}

function addMainCurrentVoice() {
    const patch = readMainFormPatch();
    const voice = getSelectedMainVoice();
    if (!patch.engine || !voice?.name) {
        setMainStatus('请先选择引擎和音色。', 'error');
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

    renderSpeakerList();
    syncSpeakerToMainList(name);
    setAllStatus(`已添加到主音色列表：${name}。角色匹配和 LLM 文本提取会继续生效。`);
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
    const mainRoot = getEl('st-is-main-local-tts-root');
    if (!enabledInput && !mainRoot) {
        retryInitLocalTtsSettings();
        return;
    }

    bindMainLocalTtsControls();

    if (!enabledInput) return;

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

function bindMainLocalTtsControls() {
    const root = getEl('st-is-main-local-tts-root');
    if (!root) return;
    if (root.dataset.localTtsBound === 'true') {
        loadMainForm();
        ensureMainResourceOption();
        return;
    }
    root.dataset.localTtsBound = 'true';
    localTtsRetryCount = 0;

    ensureMainResourceOption();
    loadMainForm();

    root.addEventListener('click', (event) => {
        const button = event.target.closest('button');
        if (!button || !root.contains(button)) return;

        if (button.id === 'st-is-main-local-tts-sync-engines') {
            runWithButton(button, '同步中...', syncMainEngines);
            return;
        }

        if (button.id === 'st-is-main-local-tts-sync-voices') {
            runWithButton(button, '同步中...', syncMainVoices);
            return;
        }

        if (button.id === 'st-is-main-local-tts-add-speaker') {
            addMainCurrentVoice();
        }
    });

    root.addEventListener('change', (event) => {
        if (event.target.matches('input, select, textarea')) {
            saveLocalTtsConfig(readMainFormPatch());
        }
    });
}
