import { useEffect, useState } from "react";

import { listsRoomOnly, readSessionState } from "./session";

/** Read again on every connect: a changed view ends the device's stream, so the reconnect is when it shows. */
export function useRoomOnly(connected: boolean): boolean {
  const [roomOnly, setRoomOnly] = useState(false);
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void readSessionState().then((state) => {
      if (alive && state.kind !== "unreachable") setRoomOnly(listsRoomOnly(state));
    });
    return () => { alive = false; };
  }, [connected]);
  return roomOnly;
}
