import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

type RecognizerLike = {
  on?(name: string, handler: (event: unknown) => void): void;
  startContinuousRecognitionAsync(
    resolve: () => void,
    reject?: (error: unknown) => void,
  ): void;
  stopContinuousRecognitionAsync(
    resolve: () => void,
    reject?: (error: unknown) => void,
  ): void;
  close(): void;
};
type PushStreamLike = { write(frame: Uint8Array): void; close(): void };
type SpeechFactory = {
  createPushStream(): PushStreamLike;
  createRecognizer(options: {
    locales: string[];
    stream: PushStreamLike;
    languageIdentificationMode: "Continuous";
  }): RecognizerLike;
};

function validateLocales(locales: string[]) {
  if (
    locales.length === 0 ||
    locales.some((locale) => locale.toLowerCase().startsWith("zh-")) ||
    new Set(locales).size !== locales.length
  ) {
    throw new Error("Invalid Speech language candidates");
  }
}

export function createSpeechRecognizer(options: {
  locales: string[];
  sdk: Record<string, unknown>;
}) {
  validateLocales(options.locales);
  const factory = options.sdk as unknown as SpeechFactory;
  let stream: PushStreamLike | undefined;
  let recognizer: RecognizerLike | undefined;
  let closed = false;
  return {
    async start(callbacks: Record<string, (event: unknown) => void>) {
      stream = factory.createPushStream();
      recognizer = factory.createRecognizer({
        locales: options.locales,
        stream,
        languageIdentificationMode: "Continuous",
      });
      for (const [name, callback] of Object.entries(callbacks)) {
        recognizer.on?.(
          name,
          name === "canceled"
            ? (event) => {
                const category =
                  (event as { category?: string }).category ?? "connection";
                callback({
                  category: `speech_${category}`,
                  transient: category === "connection",
                });
              }
            : callback,
        );
      }
      await new Promise<void>((resolve, reject) =>
        recognizer!.startContinuousRecognitionAsync(resolve, reject),
      );
    },
    write(frame: Uint8Array) {
      if (closed || !stream) throw new Error("Speech recognizer is not active");
      stream.write(frame);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (recognizer) {
        await new Promise<void>((resolve) =>
          recognizer!.stopContinuousRecognitionAsync(resolve, resolve),
        );
        recognizer.close();
      }
      stream?.close();
      recognizer = undefined;
      stream = undefined;
    },
  };
}

export async function recognizeFixture(input: {
  audio: Uint8Array;
  expectedLocale: string | null;
  languageCandidates: string[];
  environment: Record<string, string>;
}) {
  validateLocales(input.languageCandidates);
  const speechConfig = SpeechSDK.SpeechConfig.fromEndpoint(
    new URL(
      `wss://${input.environment["AZURE_SPEECH_REGION"]}.stt.speech.microsoft.com/speech/universal/v2`,
    ),
  );
  const autoDetect =
    SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(
      input.languageCandidates,
    );
  const format = SpeechSDK.AudioStreamFormat.getWaveFormatPCM(16_000, 16, 1);
  const stream = SpeechSDK.AudioInputStream.createPushStream(format);
  const audioConfig = SpeechSDK.AudioConfig.fromStreamInput(stream);
  const recognizer = SpeechSDK.SpeechRecognizer.FromConfig(
    speechConfig,
    autoDetect,
    audioConfig,
  );
  return await new Promise<{
    status: "recognized" | "unrecognized";
    locale?: string;
    text?: string;
    requestId?: string;
  }>((resolve, reject) => {
    recognizer.recognized = (_sender, event) => {
      const text = event.result.text?.trim();
      const locale =
        SpeechSDK.AutoDetectSourceLanguageResult.fromResult(event.result)
          .language;
      if (text) {
        resolve({
          status: "recognized",
          locale,
          text,
          requestId: event.result.resultId,
        });
      } else {
        resolve({ status: "unrecognized" });
      }
      recognizer.close();
    };
    recognizer.canceled = (_sender, event) => {
      recognizer.close();
      reject(new Error(`Speech request failed: ${event.reason}`));
    };
    recognizer.startContinuousRecognitionAsync(
      () => {
        stream.write(input.audio);
        stream.close();
      },
      reject,
    );
  });
}
