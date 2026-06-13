import { extension_settings } from '../../../../extensions.js';
import { saveSettingsDebounced } from '../../../../../script.js';
import { extensionName } from './config.js';

export const LOCAL_TTS_RESOURCE_ID = 'local-tts-forwarder';
export const LOCAL_TTS_API_CONFIG_NAME = '本地 TTS';

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

function getFirstObjectKey(value) {
    return Object.keys(value || {})[0] || '';
}

function ensureCurrentTtsApiConfig(root = getRootSettings()) {
    root.tts_profiles = root.tts_profiles || {};

    const profileName = root.current_tts_profile || getFirstObjectKey(root.tts_profiles) || '默认';
    root.current_tts_profile = profileName;
    root.tts_profiles[profileName] = root.tts_profiles[profileName] || {
        current_api_config: LOCAL_TTS_API_CONFIG_NAME,
        api_configs: {},
    };

    const profile = root.tts_profiles[profileName];
    profile.api_configs = profile.api_configs || {};

    const apiName = profile.current_api_config || getFirstObjectKey(profile.api_configs) || LOCAL_TTS_API_CONFIG_NAME;
    profile.current_api_config = apiName;
    profile.api_configs[apiName] = {
        app_id: '',
        access_key: '',
        synthesis_quota: -1,
        clone_quota: -1,
        speakers: {},
        ...(profile.api_configs[apiName] || {}),
    };
    profile.api_configs[apiName].speakers = profile.api_configs[apiName].speakers || {};

    return { profileName, profile, apiName, apiConfig: profile.api_configs[apiName] };
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
    return Boolean(findLocalTtsSpeaker(request.speaker) || request.resource_id === LOCAL_TTS_RESOURCE_ID);
}

export function syncLocalTtsSpeakersToMainTts(speakerNames = null) {
    const targetNames = Array.isArray(speakerNames) ? new Set(speakerNames) : null;
    const speakers = getLocalTtsSpeakers().filter((speaker) => !targetNames || targetNames.has(speaker.name));
    if (!speakers.length) {
        throw new Error('没有可同步的本地音色，请先同步手机音色并添加。');
    }

    const { apiName, apiConfig } = ensureCurrentTtsApiConfig();
    speakers.forEach((speaker) => {
        apiConfig.speakers[speaker.name] = {
            ...(apiConfig.speakers[speaker.name] || {}),
            speaker_id: speaker.voice || speaker.speaker_id || speaker.name,
            resource_id: LOCAL_TTS_RESOURCE_ID,
            description: speaker.description || '本地 TTS 转发器音色',
            engine: speaker.engine || '',
            voice: speaker.voice || '',
            local_tts: true,
        };
    });

    saveSettingsDebounced();
    return { apiName, count: speakers.length, speakers };
}

export function removeLocalTtsSpeakerFromMainTts(speakerName) {
    const root = getRootSettings();
    Object.values(root.tts_profiles || {}).forEach((profile) => {
        Object.values(profile?.api_configs || {}).forEach((apiConfig) => {
            const speaker = apiConfig?.speakers?.[speakerName];
            if (speaker?.resource_id === LOCAL_TTS_RESOURCE_ID) {
                delete apiConfig.speakers[speakerName];
            }
        });
    });
    saveSettingsDebounced();
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
