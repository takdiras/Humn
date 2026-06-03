import { useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

type UpdateState =
  | { status: "idle" }
  | { status: "available"; update: Update; version: string }
  | { status: "downloading"; progress: number }
  | { status: "done" };

export function useUpdater() {
  const [state, setState] = useState<UpdateState>({ status: "idle" });

  useEffect(() => {
    // Check once on launch, silently — don't block or alert on error
    check().then((update) => {
      if (update?.available) {
        setState({ status: "available", update, version: update.version });
      }
    }).catch(() => {});
  }, []);

  async function install() {
    if (state.status !== "available") return;
    const { update } = state;

    let downloaded = 0;
    let total = 0;

    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        setState({ status: "downloading", progress: 0 });
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        setState({
          status: "downloading",
          progress: total > 0 ? Math.round((downloaded / total) * 100) : 0,
        });
      } else if (event.event === "Finished") {
        setState({ status: "done" });
      }
    });

    await relaunch();
  }

  return { state, install };
}
