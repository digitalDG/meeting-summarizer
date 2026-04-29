/**
 * AudioWorkletProcessor: converts Float32 mic samples to Int16 PCM and posts
 * each chunk to the main thread as a transferable ArrayBuffer.
 *
 * Loaded via AudioContext.audioWorklet.addModule('/audio-processor.js').
 * Sample rate is controlled by the AudioContext (we create it at 16000 Hz).
 */
class AudioProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0]?.[0]; // mono, first channel
    if (!channel?.length) return true;

    const int16 = new Int16Array(channel.length);
    for (let i = 0; i < channel.length; i++) {
      // Clamp to [-1, 1] then scale to Int16 range
      const s = Math.max(-1, Math.min(1, channel[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    // Transfer ownership so no copy is made
    this.port.postMessage(int16.buffer, [int16.buffer]);
    return true;
  }
}

registerProcessor("audio-processor", AudioProcessor);
