import { createElement, useEffect, useRef, useState } from "react";

import { createAudioCapture } from "./audio/capture.js";
import {
  initialSubtitleState,
  reduceSubtitle,
  type SubtitleState,
} from "./protocol/subtitle-reducer.js";
import { createTranslationClient } from "./protocol/translation-client.js";

export function App() {
  const [status, setStatus] = useState("等待开始");
  const [subtitles, setSubtitles] =
    useState<SubtitleState>(initialSubtitleState);
  const cleanup = useRef<() => void>(() => undefined);

  useEffect(() => () => cleanup.current(), []);

  async function start() {
    setSubtitles(initialSubtitleState);
    setStatus("正在连接");
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(
      `${protocol}//${location.host}/ws/translation`,
      "translation.v1",
    );
    let capture: Awaited<ReturnType<typeof createAudioCapture>> | undefined;
    const client = createTranslationClient({
      socket,
      stopMedia: () => void capture?.stop(),
      onEvent: (event) => {
        if (event.type === "session.ready") setStatus("正在听取");
        setSubtitles((state) => {
          const next = reduceSubtitle(state, event);
          if (next.closeRequired) client.unload();
          return next;
        });
      },
    });
    socket.onopen = async () => {
      capture = await createAudioCapture((frame) => client.sendAudio(frame));
      client.start();
    };
    socket.onmessage = ({ data }) => client.receive(data);
    socket.onclose = () => setStatus("已停止");
    cleanup.current = () => client.unload();
  }

  return createElement(
    "main",
    null,
    createElement("h1", null, "会议实时中文字幕"),
    createElement("p", { "aria-live": "polite" }, status),
    createElement("button", { onClick: () => void start() }, "开始"),
    createElement("button", { onClick: () => cleanup.current() }, "停止"),
    createElement(
      "section",
      { "aria-label": "中文字幕" },
      subtitles.segments.map((segment) =>
        segment.status === "unrecognized"
          ? createElement(
              "p",
              {
                key: segment.sequence,
                "data-testid": "segment-unrecognized",
              },
              "当前发言无法识别",
            )
          : segment.text
            ? createElement(
                "p",
                {
                  key: segment.sequence,
                  "data-testid": "subtitle-segment",
                  "data-final": String(segment.terminal),
                  "data-source-locale": segment.sourceLocale,
                },
                segment.text,
              )
            : null,
      ),
    ),
  );
}
