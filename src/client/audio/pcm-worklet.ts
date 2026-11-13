declare const AudioWorkletProcessor: {
  new (): {
    readonly port: MessagePort;
  };
};
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs: Float32Array[][]): boolean {
    const channel = inputs[0]?.[0];
    if (channel?.length) this.port.postMessage(channel.slice());
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
