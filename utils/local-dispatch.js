import { requestLocalTtsAudio } from './local-tts.js';

export async function initiateLocalTtsRequest(request = {}, hooks = {}) {
    const {
        addOrUpdateTtsItem,
        getTtsItem,
        ttsNotifyStart,
        ttsNotifyEnd,
        force = false,
    } = hooks;

    if (!addOrUpdateTtsItem) {
        throw new Error('本地 TTS 缓存入口未初始化。');
    }

    const cacheKey = request.cacheKey || `local-tts:${request.speaker || 'default'}:${request.text || ''}`;
    const cachedItem = getTtsItem?.(cacheKey);
    if (cachedItem?.status === 'ready' && !force) {
        return cachedItem;
    }

    addOrUpdateTtsItem(cacheKey, {
        cacheKey,
        text: request.text,
        context_texts: request.context_texts,
        speaker: request.speaker,
        speaker_name: request.speaker,
        ir_description: request.ir_description,
        special_effects: request.special_effects,
        spatial: request.spatial,
        metadata: request.metadata,
        status: 'pending',
    });

    try {
        if (ttsNotifyStart) {
            ttsNotifyStart('local', '本地TTS');
        }

        const { arrayBuffer, mime } = await requestLocalTtsAudio(request);
        const audioBlob = new Blob([arrayBuffer], { type: mime || 'audio/x-wav' });
        const audioUrl = URL.createObjectURL(audioBlob);

        return addOrUpdateTtsItem(cacheKey, {
            status: 'ready',
            audioBuffer: arrayBuffer,
            audioBlob,
            audioUrl,
            text: request.text,
            context_texts: request.context_texts,
            speaker: request.speaker,
            speaker_name: request.speaker,
            ir_description: request.ir_description,
            special_effects: request.special_effects,
            spatial: request.spatial,
            metadata: request.metadata,
        });
    } catch (error) {
        addOrUpdateTtsItem(cacheKey, {
            status: 'error',
            error: error?.message || String(error),
        });
        throw error;
    } finally {
        if (ttsNotifyEnd) {
            ttsNotifyEnd('local');
        }
    }
}
