import { readFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";

export async function installFixtureAudio(
  page: Page,
  fixture: "recognized-language-a.wav" | "recognized-language-b.wav" | "unrecognized.wav",
): Promise<void> {
  const bytes = await readFile(
    new URL(`../../fixtures/audio/${fixture}`, import.meta.url),
  );
  await page.addInitScript((encodedAudio) => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio) {
        return original(constraints);
      }
      const binary = atob(encodedAudio);
      const wav = Uint8Array.from(binary, (character) =>
        character.charCodeAt(0),
      );
      const context = new AudioContext();
      const buffer = await context.decodeAudioData(wav.buffer);
      const source = context.createBufferSource();
      const destination = context.createMediaStreamDestination();
      source.buffer = buffer;
      source.connect(destination);
      source.start();
      return destination.stream;
    };
  }, bytes.toString("base64"));
}

export async function candidateIdentity(page: Page): Promise<{
  deliveryId: string;
  candidateSha: string;
}> {
  const response = await page.request.get("/candidate-identity");
  expectOk(response.ok(), "candidate identity endpoint");
  return (await response.json()) as {
    deliveryId: string;
    candidateSha: string;
  };
}

export async function attachControlledEvidence(
  page: Page,
  testInfo: TestInfo,
  evidence: {
    scenario: string;
    fixtureIds: string[];
    candidateIdentity: { deliveryId: string; candidateSha: string };
    eventOrder: string[];
  },
): Promise<void> {
  await page.screenshot({
    path: testInfo.outputPath(`${evidence.scenario}.png`),
    fullPage: true,
  });
  await testInfo.attach("controlled-evidence-metadata", {
    body: Buffer.from(JSON.stringify(evidence)),
    contentType: "application/json",
  });
}

function expectOk(value: boolean, subject: string): asserts value {
  if (!value) {
    throw new Error(`${subject} is not available`);
  }
}
