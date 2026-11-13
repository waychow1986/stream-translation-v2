import { expect, test } from "@playwright/test";

import {
  attachControlledEvidence,
  candidateIdentity,
  installFixtureAudio,
} from "./support/audio-input.js";

test.skip(
  !process.env["DEV_FUNCTIONAL_BASE_URL"],
  "requires the deployed candidate URL and real Azure integration",
);

test("IQA-002 translates a second supported language without preset selection", async ({
  page,
}, testInfo) => {
  await installFixtureAudio(page, "recognized-language-b.wav");
  await page.goto(process.env["DEV_FUNCTIONAL_BASE_URL"]!);
  const identity = await candidateIdentity(page);
  expect(identity.candidateSha).toBe(process.env["AIDELIVERY_CANDIDATE_SHA"]);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await page.getByRole("button", { name: "开始" }).click();
  const subtitle = page.getByTestId("subtitle-segment").first();
  await expect(subtitle).toHaveAttribute("data-source-locale", "fr-FR");
  await expect(subtitle).toHaveAttribute("data-final", "true");
  await expect(subtitle).toContainText("会议");
  await expect(subtitle).toContainText("开始");
  await attachControlledEvidence(page, testInfo, {
    scenario: "IQA-002",
    fixtureIds: ["recognized-language-b"],
    candidateIdentity: identity,
    eventOrder: ["session.ready", "segment.detected", "subtitle.final"],
  });
});
