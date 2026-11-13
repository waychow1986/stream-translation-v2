import { readFile } from "node:fs/promises";

import type { Page, TestInfo } from "@playwright/test";

export async function installFixtureAudio(
  page: Page,
  fixture: "recognized-language-a.wav" | "recognized-language-b.wav" | "unrecognized.wav",
): Promise<void> {
  await installFixtureAudioSequence(page, [fixture]);
}

export async function installFixtureAudioSequence(
  page: Page,
  fixtures: Array<
    "recognized-language-a.wav" | "recognized-language-b.wav" | "unrecognized.wav"
  >,
): Promise<void> {
  const encodedAudio = await Promise.all(
    fixtures.map(async (fixture) =>
      (
        await readFile(
          new URL(`../../fixtures/audio/${fixture}`, import.meta.url),
        )
      ).toString("base64"),
    ),
  );
  await page.addInitScript((encodedFixtures) => {
    const original = navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices,
    );
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!constraints?.audio) {
        return original(constraints);
      }
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      let startAt = context.currentTime;
      for (const encodedAudio of encodedFixtures) {
        const binary = atob(encodedAudio);
        const wav = Uint8Array.from(binary, (character) =>
          character.charCodeAt(0),
        );
        const buffer = await context.decodeAudioData(wav.buffer);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(destination);
        source.start(startAt);
        startAt += buffer.duration;
      }
      return destination.stream;
    };
  }, encodedAudio);
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
