import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';

export const LOCAL_TTS_RESOURCE_ID = 'local-tts-forwarder';

const DEFAULT_LOCAL_TTS = {
    enabled: false,
    baseUrl: '',
    engine: '',
    voice: '',
    rate: 50,
    pitch: 100,
    speakers: {},
    engines: [],
    voices: [],
};

function getRootSettings() {
    if (!extension_settings[extensionName]) {
        extension_settings[extensionName] = {};
    }
    return extension_settings[extensionName];
}

export function getLocalTtsConfig() {
    const root = getRootSettings();
    root.local_tts = {
        ...DEFAULT_LOCAL_TTS,
        ...(root.local_tts || {}),
        speakers: { ...((root.local_tts && root.local_tts.speakers) || {}) },
        engines: Array.isArray(root.local_tts?.engines) ? root.local_tts.engines : [],
        voices: Array.isArray(root.local_tts?.voices) ? root.local_tts.voices : [],
    };
    return root.local_tts;
}

export function saveLocalTtsConfig(patch = {}) {
    const root = getRootSettings();
    const current = getLocalTtsConfig();
    root.local_tts = {
        ...current,
        ...patch,
        speakers: patch.speakers || current.speakers || {},
        engines: patch.engines || current.engines || [],
        voices: patch.voices || current.voices || [],
    };

    if (root.local_tts.enabled) {
        root.current_tts_provider = 'doubao';
    }

    saveSettingsDebounced();
    return root.local_tts;
}

function normalizeBaseUrl(baseUrl) {
    const rawUrl = String(baseUrl || '').trim();
    if (!rawUrl) return '';
    const withProtocol = /^https?:\/\//i.test(rawUrl) ? rawUrl : `http://${rawUrl}`;
    return withProtocol.replace(/\/+$/, '');
}

function makeUrl(baseUrl, path, params = {}) {
    const url = new URL(`${normalizeBaseUrl(baseUrl)}${path}`);
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value) !== '') {
            url.searchParams.set(key, String(value));
        }
    });
    return url.toString();
}

async function fetchWithTimeout(url, options = {}, timeout = 8000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
        if (error?.name === 'AbortError') {
            throw new Error('连接手机 TTS 转发器超时。');
        }
        throw new Error('连接手机 TTS 转发器失败，请检查地址、网络和转发器是否已启动。');
    } finally {
        clearTimeout(timer);
    }
}

async function fetchJson(url, errorLabel) {
    const response = await fetchWithTimeout(url, { method: 'GET', mode: 'cors' });
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`${errorLabel}失败：HTTP ${response.status}${text ? `，${text}` : ''}`);
    }
    return response.json();
}

export async function fetchLocalTtsEngines(baseUrl = getLocalTtsConfig().baseUrl) {
    if (!normalizeBaseUrl(baseUrl)) {
        throw new Error('请先填写手机 TTS 转发器地址。');
    }
    return fetchJson(makeUrl(baseUrl, '/api/engines'), '加载本地 TTS 引擎');
}

export async function fetchLocalTtsVoices(engine, baseUrl = getLocalTtsConfig().baseUrl) {
    if (!normalizeBaseUrl(baseUrl)) {
        throw new Error('请先填写手机 TTS 转发器地址。');
    }
    if (!engine) {
        throw new Error('请先选择本地 TTS 引擎。');
    }
    return fetchJson(makeUrl(baseUrl, '/api/voices', { engine }), '加载本地 TTS 音色');
}

export function formatLocalVoiceLabel(voice) {
    if (!voice) return '';
    const name = voice.name || voice.voice || '';
    const locale = voice.localeName || voice.locale || '';
    const features = voice.features || '';
    return [name, locale, features].filter(Boolean).join(' / ');
}

export function buildLocalSpeakerName(engine, voice) {
    const label = formatLocalVoiceLabel(voice);
    const engineName = engine || '本地引擎';
    return label ? `本地-${engineName}-${label}` : `本地-${engineName}`;
}

export function getLocalTtsSpeakers() {
    const config = getLocalTtsConfig();
    if (!config.enabled) return [];

    return Object.entries(config.speakers || {}).map(([name, speaker]) => ({
        name,
        speaker_id: speaker.voice || config.voice || name,
        resource_id: LOCAL_TTS_RESOURCE_ID,
        description: speaker.label || '本地 TTS 转发器音色',
        engine: speaker.engine || config.engine,
        voice: speaker.voice || config.voice,
        locale: speaker.locale || '',
        local_tts: true,
    }));
}

export function mergeLocalTtsSpeakers(speakers = []) {
    const merged = new Map();
    speakers.forEach((speaker) => {
        if (speaker && speaker.name) {
            merged.set(speaker.name, speaker);
        }
    });

    getLocalTtsSpeakers().forEach((speaker) => {
        if (!merged.has(speaker.name)) {
            merged.set(speaker.name, speaker);
        }
    });

    return Array.from(merged.values());
}

export function findLocalTtsSpeaker(name) {
    return getLocalTtsSpeakers().find((speaker) => speaker.name === name) || null;
}

export function isLocalTtsRequest(request = {}) {
    return Boolean(findLocalTtsSpeaker(request.speaker));
}

export async function fetchLocalTtsAudio({ baseUrl, text, engine, voice, rate, pitch }) {
    if (!normalizeBaseUrl(baseUrl)) {
        throw new Error('请先填写手机 TTS 转发器地址。');
    }
    if (!engine) {
        throw new Error('请先选择本地 TTS 引擎。');
    }
    if (!text || !String(text).trim()) {
        throw new Error('没有可朗读的文本。');
    }

    const url = makeUrl(baseUrl, '/api/tts', {
        text,
        engine,
        rate: rate || 50,
        pitch: pitch || 100,
        voice,
    });
    const response = await fetchWithTimeout(url, { method: 'GET', mode: 'cors' }, 15000);
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`本地 TTS 合成失败：HTTP ${response.status}${errorText ? `，${errorText}` : ''}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const mime = response.headers.get('content-type') || 'audio/x-wav';
    return { arrayBuffer, mime, url };
}

export async function requestLocalTtsAudio(request = {}) {
    const config = getLocalTtsConfig();
    const speaker = findLocalTtsSpeaker(request.speaker);
    if (!speaker) {
        throw new Error(`没有找到本地 TTS 音色：${request.speaker || '未指定'}`);
    }

    return fetchLocalTtsAudio({
        baseUrl: config.baseUrl,
        text: request.text,
        engine: speaker.engine || config.engine,
        voice: speaker.voice || config.voice,
        rate: config.rate,
        pitch: config.pitch,
    });
}
